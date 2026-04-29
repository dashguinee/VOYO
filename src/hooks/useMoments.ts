/**
 * useMoments - Control vs Surrender Navigation
 *
 * UP = Control (deeper in time, same category)
 * DOWN = Surrender (bleed into adjacent category via weighted adjacency)
 * LEFT = Memory (retrace trail with fading precision)
 * RIGHT = Drift (explore new category, avoids recent)
 * Tabs = Hard shift (intentional dimension change)
 *
 * Features:
 * - Weighted adjacency maps for organic drift between categories
 * - Trail system (last 50 positions) with fading memory precision
 * - Auto-drift after 5+ consecutive UP swipes (30% chance)
 * - Velocity-based navigation (faster swipe = bigger jumps)
 * - Stars system (1 star = follow, double-tap-hold gesture)
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { devWarn } from '../utils/logger';
import type { Moment } from '../types/moments';
import { getInsights as getOyoInsights, hydrateFromSignals } from '../services/oyoDJ';
import { usePlayerStore } from '../store/playerStore';
import {
  rankMoments,
  recordSessionPlay,
  recordSessionSkip,
  getEngagedCreators,
  recordSessionStar,
  markShown,
} from '../services/momentsEngine';

// Circuit breaker: voyo_moments queries time out when table lacks indexes.
// After first timeout, stop making requests to prevent repeated 500s in console.
let _momentsBlocked = false;

// ============================================
// TYPES
// ============================================

// v860 — Moments top-row redesign per Dash's spec:
// "Top can be Vibes Right Now, Live, Friends".
// The 3 modes each carry their own sub-categories AND their own
// fetch grammar. The point is to break the locked-in feel of the
// old countries/vibes/genres taxonomy — every mode pulls a
// different SHAPE of moment, not the same data filtered three ways.
//
//   'vibes-now' : current emotional axes (dance/comedy/live/etc),
//                 quality-weighted, biased by what you're playing.
//   'live'      : time-window cuts (now / today / this week),
//                 newest viral content, freshness > taste.
//   'friends'   : creators you've starred + recently engaged with;
//                 social graph view, not algorithmic.
//
// CategoryAxis name preserved so the prop chain doesn't break, but
// the values shift. UI labels surface the friendly versions.
export type CategoryAxis = 'vibes-now' | 'live' | 'friends';

export interface MomentPosition {
  categoryIndex: number;
  timeIndex: number;
}

export type NavAction = 'up' | 'down' | 'left' | 'right' | 'tab' | null;

export interface TrailEntry {
  momentId: string | null;
  categoryAxis: CategoryAxis;
  category: string;
  categoryIndex: number;
  timeIndex: number;
  timestamp: number;
  action: NavAction;
}

export interface UseMomentsReturn {
  currentMoment: Moment | null;
  position: MomentPosition;
  categoryAxis: CategoryAxis;
  categories: string[];
  currentCategory: string;
  displayName: (key: string) => string;
  goUp: (velocity?: number) => void;
  goDown: (velocity?: number) => void;
  goLeft: (velocity?: number) => void;
  goRight: (velocity?: number) => void;
  setCategoryAxis: (axis: CategoryAxis) => void;
  jumpToCategory: (index: number) => void;
  moments: Map<string, Moment[]>;
  loading: boolean;
  totalInCategory: number;
  navAction: NavAction;
  trail: TrailEntry[];
  recordPlay: (momentId: string) => void;
  recordOye: (momentId: string) => void;
  recordStar: (momentId: string, creatorUsername: string, stars: number) => void;
  /** v832 — fire when the user navigates away before the 1.5s dwell.
   *  Soft-negative on the creator's session weight. */
  recordSkip: (momentId: string) => void;
  fetchMomentsForCategory: (axis: CategoryAxis, category: string, offset?: number) => Promise<void>;
  cacheKey: (axis: CategoryAxis, cat: string) => string;
}

// ============================================

export const CATEGORY_PRESETS: Record<CategoryAxis, string[]> = {
  // Vibes Right Now — emotional handles, quality-weighted, your default
  // exploration mode. Same set of vibes the prior taxonomy used; it's
  // the FETCH GRAMMAR + UI framing that changes, not the labels.
  'vibes-now': [
    'dance', 'comedy', 'live', 'fashion', 'original', 'cover', 'reaction',
  ],
  // v860 — Live = virality cuts (NOT time windows). Diagnostic on the
  // live catalog: every moment was ingested in a single 22-minute
  // burst 87 days ago. discovered_at is effectively static, so
  // time-window filters return 0. virality_score IS the recency
  // signal in this catalog. Cuts:
  //   pulse   : top virality (highest 100, the absolute heat)
  //   rising  : next tier (100-500, climbers)
  //   gems    : long-tail viral (500+ rank, hidden bangers)
  'live': [
    'pulse', 'rising', 'gems',
  ],
  // Friends — followed creators (sessionStarred) + recently-OYEd authors.
  // Single chip for v860; we'll add 'all' / 'starred' / 'newly followed'
  // sub-cuts once the social graph fills out.
  'friends': [
    'all',
  ],
};

// Display names for UI (map internal keys to pretty labels)
const DISPLAY_NAMES: Record<string, string> = {
  // Vibes Right Now sub-categories
  'dance': 'Dance', 'comedy': 'Comedy', 'live': 'Live', 'fashion': 'Fashion',
  'original': 'Original', 'cover': 'Cover', 'reaction': 'Reaction',
  // Live sub-categories (virality cuts)
  'pulse': 'Pulse', 'rising': 'Rising', 'gems': 'Gems',
  // Friends sub-categories
  'all': 'My Crew',
};

// v860 — labels for the 3 top modes (used by the axis-tab strip)
export const TOP_MODE_LABELS: Record<CategoryAxis, string> = {
  'vibes-now': 'Vibes Right Now',
  'live':      'Live',
  'friends':   'Friends',
};

const MOMENTS_PER_PAGE = 20;
const MAX_TRAIL = 50;
const AUTO_DRIFT_THRESHOLD = 5; // consecutive UPs before drift chance
const AUTO_DRIFT_CHANCE = 0.3;

// v832-v859 — Moments Engine. The fetch oversampling factor controls
// how many candidates the engine sees vs the page size. v859 bumped
// 3× → 8× because diagnostic showed entire fresh-half batches were
// monoculture (e.g. comedy: 100% ichievoodoo recent), and the v858
// hard cap was leaving pages short (8/20) when the candidate pool
// itself was thin. With 8× oversample (~320 candidates per fetch),
// even monoculture-heavy categories yield enough diverse creators
// to fill a 20-slot page under the cap.
const FETCH_OVERSAMPLE = 8;        // 8× page → ~320 candidates per fetch
const MAX_PER_CREATOR = 2;          // hard cap per creator per page
// v859: when engine ranking returns fewer than this fraction of the
// target page, bleed in moments from adjacent-vibe categories so the
// user sees a full feed even in a sparse category.
const BLEED_THRESHOLD_RATIO = 0.6;

// ============================================
// ADJACENCY MAPS (weighted neighbors for drift/bleed)
// ============================================

// v860 — adjacency now keyed by the new top-mode taxonomy. Drift
// (left/right) traverses these weighted edges within the current
// top mode. Friends has a single sub-cat ('all') so drift is a
// no-op there — that's intentional, the social graph isn't a
// taxonomy you wander, it's people you've chosen.
const ADJACENCY: Record<CategoryAxis, Record<string, Record<string, number>>> = {
  'vibes-now': {
    'dance':    { 'live': 0.3, 'fashion': 0.2, 'original': 0.2, 'comedy': 0.15, 'cover': 0.1, 'reaction': 0.05 },
    'comedy':   { 'reaction': 0.3, 'live': 0.25, 'dance': 0.2, 'original': 0.15, 'cover': 0.1 },
    'live':     { 'dance': 0.3, 'comedy': 0.2, 'original': 0.2, 'cover': 0.15, 'fashion': 0.1, 'reaction': 0.05 },
    'fashion':  { 'dance': 0.3, 'original': 0.25, 'live': 0.2, 'comedy': 0.1, 'cover': 0.1, 'reaction': 0.05 },
    'original': { 'cover': 0.25, 'dance': 0.2, 'live': 0.2, 'fashion': 0.15, 'comedy': 0.1, 'reaction': 0.1 },
    'cover':    { 'original': 0.3, 'live': 0.25, 'dance': 0.2, 'reaction': 0.15, 'comedy': 0.1 },
    'reaction': { 'comedy': 0.3, 'cover': 0.2, 'live': 0.2, 'original': 0.15, 'dance': 0.1, 'fashion': 0.05 },
  },
  'live': {
    'pulse':  { 'rising': 0.7, 'gems': 0.3 },
    'rising': { 'pulse': 0.4, 'gems': 0.6 },
    'gems':   { 'rising': 0.6, 'pulse': 0.4 },
  },
  'friends': {
    'all': {},
  },
};

// Pick a weighted random neighbor from adjacency map
function pickWeightedNeighbor(
  axis: CategoryAxis,
  current: string,
  recentCategories: string[] = [],
  exoticBias: number = 0, // 0-1, higher = prefer less-visited
): string {
  const neighbors = ADJACENCY[axis][current];
  if (!neighbors) return current;

  const entries = Object.entries(neighbors);
  // Boost weights for categories NOT in recent trail
  const adjusted = entries.map(([cat, weight]) => {
    const isRecent = recentCategories.includes(cat);
    const boost = isRecent ? (1 - exoticBias * 0.5) : (1 + exoticBias * 0.5);
    return { cat, weight: weight * boost };
  });

  const totalWeight = adjusted.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const { cat, weight } of adjusted) {
    roll -= weight;
    if (roll <= 0) return cat;
  }

  return entries[0][0]; // fallback
}

// ============================================
// HOOK
// ============================================

export function useMoments(): UseMomentsReturn {
  const [categoryAxis, setCategoryAxisState] = useState<CategoryAxis>('vibes-now');
  const [position, setPosition] = useState<MomentPosition>({ categoryIndex: 0, timeIndex: 0 });
  const [moments, setMoments] = useState<Map<string, Moment[]>>(new Map());
  const [loading, setLoading] = useState(false);

  // Track which categories have been fetched to avoid re-fetching
  const fetchedRef = useRef<Set<string>>(new Set());
  // Track ongoing fetches to avoid duplicates
  const fetchingRef = useRef<Set<string>>(new Set());

  // Trail: history of navigation for LEFT (memory) retracing
  const trailRef = useRef<TrailEntry[]>([]);
  const [trail, setTrail] = useState<TrailEntry[]>([]);
  // Consecutive UP swipes for auto-drift trigger
  const consecutiveUpsRef = useRef(0);
  // Last navigation action for animation differentiation
  const [navAction, setNavAction] = useState<NavAction>(null);

  const categories = useMemo(() => CATEGORY_PRESETS[categoryAxis], [categoryAxis]);
  const currentCategory = categories[position.categoryIndex] || categories[0];

  // Build a cache key combining axis + category for fetch dedup
  const cacheKey = useCallback(
    (axis: CategoryAxis, cat: string) => `${axis}::${cat}`,
    []
  );

  // ============================================
  // DATA FETCHING
  // ============================================

  const fetchMomentsForCategory = useCallback(
    async (axis: CategoryAxis, category: string, offset = 0) => {
      if (!supabase || !isSupabaseConfigured || _momentsBlocked) return;

      const key = cacheKey(axis, category);

      // Skip if already fetching this exact key
      if (fetchingRef.current.has(key) && offset === 0) return;
      // Skip if already fetched initial page (offset 0)
      if (fetchedRef.current.has(key) && offset === 0) return;

      fetchingRef.current.add(key);
      if (offset === 0) setLoading(true);

      try {
        // v858 MULTI-PASS FETCH. Two queries run in parallel for the
        // same category: one ordered by virality_score (the quality
        // backbone — eliminates the recent-creator monoculture from
        // v857's diagnosis), one ordered by discovered_at (the freshness
        // top-up). Results merged + de-duped on the client.
        //
        // Why both: virality_score alone underweights brand-new posts
        // (no engagement signal yet). Recency alone is the bug we just
        // fixed. Combined: half quality / half fresh, ranked by engine.
        const HALF = Math.ceil((MOMENTS_PER_PAGE * FETCH_OVERSAMPLE) / 2);

        // v860 — fetch grammar branches per TOP MODE, not just per
        // axis filter. Each mode pulls a different SHAPE of moment
        // so the surfaces feel genuinely different, not the same
        // catalog filtered three ways.
        const buildQuery = (orderBy: 'virality' | 'recency') => {
          let q = supabase!
            .from('voyo_moments')
            .select('*')
            .eq('is_active', true);
          if (orderBy === 'virality') {
            q = q.order('virality_score', { ascending: false, nullsFirst: false })
                 .order('discovered_at', { ascending: false });
          } else {
            q = q.order('discovered_at', { ascending: false });
          }
          q = q.range(offset * FETCH_OVERSAMPLE, offset * FETCH_OVERSAMPLE + HALF - 1);

          if (axis === 'vibes-now') {
            // Emotional axes — filter by content_type vibe label.
            q = q.eq('content_type', category);
          } else if (axis === 'live') {
            // v860 — virality cuts (NOT time windows). The catalog
            // is static (last ingest 87d ago per circulation
            // diagnostic), so discovered_at filters return 0.
            // virality_score IS the heat signal in this catalog.
            //   pulse  : rank 1-100 (top 1.5%)
            //   rising : rank 100-500 (top ~7%)
            //   gems   : rank 500-2000 (mid-tier viral)
            // Implemented via virality_score thresholds at p99/p95/p75.
            const minViralityFor: Record<string, number> = {
              'pulse':  120000, // ~p99 (4732 moments above 1000; p99 cuts to ~top 100)
              'rising':  20000, // ~p95
              'gems':     2500, // ~p75
            };
            const maxViralityFor: Record<string, number | null> = {
              'pulse':  null,
              'rising': 120000,
              'gems':    20000,
            };
            const minV = minViralityFor[category] ?? 1000;
            q = q.gte('virality_score', minV);
            const maxV = maxViralityFor[category];
            if (maxV !== null && maxV !== undefined) q = q.lt('virality_score', maxV);
          } else if (axis === 'friends') {
            // Social graph — moments by creators the user has
            // engaged with. v860 v1: pull from sessionStarred +
            // strong session-weight creators (getEngagedCreators).
            // Future: hydrate from voyo_stars / voyo_signals tables.
            const starred = Array.from(getEngagedCreators());
            if (starred.length === 0) {
              // Sentinel: friends empty. Caller skips the fetch.
              return null;
            }
            q = q.in('creator_username', starred);
          }
          return q;
        };

        const viralQ = buildQuery('virality');
        const freshQ = buildQuery('recency');

        // v860: friends-empty sentinel. buildQuery returns null when
        // the user has no engaged creators yet. We skip the fetch
        // entirely (better UX hint than empty rows from DB) and
        // surface an empty list — the UI's empty-state copy explains
        // "follow some creators to fill this lane".
        if (viralQ === null || freshQ === null) {
          setMoments(prev => {
            const next = new Map(prev);
            if (offset === 0) next.set(key, []);
            return next;
          });
          fetchedRef.current.add(key);
          return;
        }

        const [viralRes, freshRes] = await Promise.all([viralQ, freshQ]);
        const error = viralRes.error || freshRes.error;
        if (error) {
          if (error.message?.includes('timeout') || error.message?.includes('statement')) {
            _momentsBlocked = true;
            devWarn('[useMoments] DB timeout — moments queries disabled until next reload');
          } else {
            devWarn(`[useMoments] Fetch error for ${category}:`, error.message);
          }
          return;
        }

        // Merge + dedup the two passes by moment id.
        const seen = new Set<string>();
        const raw: Moment[] = [];
        for (const list of [viralRes.data || [], freshRes.data || []]) {
          for (const m of list as Moment[]) {
            if (m?.id && !seen.has(m.id)) {
              seen.add(m.id);
              raw.push(m);
            }
          }
        }
        // v858: cross-surface seed — pull the currently-playing track's
        // mode/artist/tags from the player store. Moments matching
        // them rank higher so the feed "drops near the vibe of what's
        // playing" (Dash's groundbreaking-logic spec). Read from the
        // store at fetch time, not closure-bind, so seed reflects the
        // latest track without re-mounting the hook.
        const seedTrack = usePlayerStore.getState().currentTrack;
        // v832: rank by taste + session affinity + engagement priors.
        // favoriteArtists / favoriteMoods come from getOyoInsights() —
        // the same hydrated taste graph the audio HotPool reads, so a
        // user who loves Burna Boy on the music side will see Burna's
        // moments rise to the top here too.
        const insights = getOyoInsights();
        const rankCtx = {
          favoriteArtists: new Set(insights.favoriteArtists.map(a => a.toLowerCase())),
          favoriteMoods: new Set(insights.favoriteMoods.map(m => m.toLowerCase())),
          take: MOMENTS_PER_PAGE,
          maxPerCreator: MAX_PER_CREATOR,
          seedMode: (seedTrack as unknown as { detectedMode?: string })?.detectedMode,
          seedArtist: seedTrack?.artist,
          seedTags: [
            ...((seedTrack as unknown as { tags?: string[] })?.tags ?? []),
            ...((seedTrack as unknown as { vibeTags?: string[] })?.vibeTags ?? []),
          ].filter(Boolean),
        };
        let fetched = rankMoments(raw, rankCtx);

        // v859 CROSS-CATEGORY BLEED. If the hard cap left the page
        // short (catalog too monoculture), pull from adjacent
        // categories using the existing weighted ADJACENCY map. The
        // engine re-ranks the unified candidate pool so bled-in
        // moments compete fairly with the primary category's. User
        // never sees a half-empty feed even when the chosen vibe is
        // dominated by one creator.
        if (fetched.length < Math.floor(MOMENTS_PER_PAGE * BLEED_THRESHOLD_RATIO)) {
          const seenIds = new Set(fetched.map(m => m.id));
          // Pull the top 3 weighted neighbors of this category.
          const neighbours = ADJACENCY[axis]?.[category] || {};
          const neighborCats = Object.entries(neighbours)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([cat]) => cat);

          const bleedRaw: Moment[] = [...raw];
          for (const nc of neighborCats) {
            try {
              let nq = supabase!
                .from('voyo_moments')
                .select('*')
                .eq('is_active', true)
                .order('virality_score', { ascending: false, nullsFirst: false })
                .order('discovered_at', { ascending: false })
                .range(0, MOMENTS_PER_PAGE * 2 - 1);
              // v860 — bleed only applies to vibes-now; live and friends
              // don't have neighbor-cat semantics in the new taxonomy.
              if (axis === 'vibes-now') nq = nq.eq('content_type', nc);
              else continue; // skip non-vibes-now bleed for now
              const { data: nd } = await nq;
              for (const m of (nd || []) as Moment[]) {
                if (m?.id && !seenIds.has(m.id)) {
                  seenIds.add(m.id);
                  bleedRaw.push(m);
                }
              }
            } catch { /* one neighbor failing shouldn't stall the page */ }
          }
          fetched = rankMoments(bleedRaw, rankCtx);
        }

        setMoments(prev => {
          const next = new Map(prev);
          const existing = next.get(key) || [];
          if (offset === 0) {
            next.set(key, fetched);
          } else {
            // Append, dedup by id
            const ids = new Set(existing.map(m => m.id));
            const newItems = fetched.filter(m => !ids.has(m.id));
            next.set(key, [...existing, ...newItems]);
          }
          return next;
        });

        fetchedRef.current.add(key);
      } catch (err) {
        devWarn('[useMoments] Fetch exception:', err);
      } finally {
        fetchingRef.current.delete(key);
        if (offset === 0) setLoading(false);
      }
    },
    [cacheKey]
  );

  // v832: hydrate the cross-session taste graph from voyo_signals once
  // per session so favoriteArtists / favoriteMoods are populated before
  // the first ranking pass runs. Idempotent inside oyoDJ — safe to call
  // multiple times. The audio side already calls this on its own boot
  // path; this is a belt-and-suspenders for the Moments-first user.
  useEffect(() => {
    void hydrateFromSignals();
  }, []);

  // Fetch current category on mount and when axis/category changes
  useEffect(() => {
    fetchMomentsForCategory(categoryAxis, currentCategory);
  }, [categoryAxis, currentCategory, fetchMomentsForCategory]);

  // Pre-fetch adjacent categories for smoother swiping
  useEffect(() => {
    const prevIdx = (position.categoryIndex - 1 + categories.length) % categories.length;
    const nextIdx = (position.categoryIndex + 1) % categories.length;

    const prevCat = categories[prevIdx];
    const nextCat = categories[nextIdx];

    // Slight delay to prioritize current category
    const timer = setTimeout(() => {
      fetchMomentsForCategory(categoryAxis, prevCat);
      fetchMomentsForCategory(categoryAxis, nextCat);
    }, 300);

    return () => clearTimeout(timer);
  }, [categoryAxis, position.categoryIndex, categories, fetchMomentsForCategory]);

  // ============================================
  // CURRENT STATE
  // ============================================

  const currentKey = cacheKey(categoryAxis, currentCategory);
  const currentMoments = moments.get(currentKey) || [];
  const currentMoment = currentMoments[position.timeIndex] || null;
  const totalInCategory = currentMoments.length;

  // ============================================
  // TRAIL HELPERS
  // ============================================

  const pushTrail = useCallback((action: NavAction) => {
    const entry: TrailEntry = {
      momentId: currentMoment?.id || null,
      categoryAxis,
      category: currentCategory,
      categoryIndex: position.categoryIndex,
      timeIndex: position.timeIndex,
      timestamp: Date.now(),
      action,
    };
    trailRef.current = [...trailRef.current.slice(-(MAX_TRAIL - 1)), entry];
    setTrail([...trailRef.current]);
  }, [currentMoment, categoryAxis, currentCategory, position]);

  const getRecentCategories = useCallback((): string[] => {
    return trailRef.current
      .slice(-10)
      .map(e => e.category)
      .filter((v, i, a) => a.indexOf(v) === i);
  }, []);

  // ============================================
  // NAVIGATION (Control vs Surrender)
  // ============================================

  // UP = CONTROL: deeper in same category (deterministic)
  const goUp = useCallback((velocity: number = 0) => {
    pushTrail('up');
    setNavAction('up');
    consecutiveUpsRef.current += 1;

    setPosition(prev => {
      const cats = CATEGORY_PRESETS[categoryAxis];
      const cat = cats[prev.categoryIndex] || '';
      const key = cacheKey(categoryAxis, cat);
      const categoryMoments = moments.get(key) || [];

      // Velocity: fast swipe = skip 2-3, normal = skip 1
      const skip = velocity > 1.5 ? Math.min(Math.floor(velocity), 3) : 1;
      let newTimeIndex = Math.min(prev.timeIndex + skip, categoryMoments.length - 1);
      newTimeIndex = Math.max(newTimeIndex, 0);

      // Auto-paginate near end
      if (newTimeIndex >= categoryMoments.length - 3 && cat) {
        fetchMomentsForCategory(categoryAxis, cat, categoryMoments.length);
      }

      // Auto-drift check: after threshold consecutive UPs, chance to bleed
      if (consecutiveUpsRef.current > AUTO_DRIFT_THRESHOLD && Math.random() < AUTO_DRIFT_CHANCE) {
        const driftTarget = pickWeightedNeighbor(categoryAxis, cat, getRecentCategories());
        const driftIdx = cats.indexOf(driftTarget);
        if (driftIdx !== -1 && driftIdx !== prev.categoryIndex) {
          consecutiveUpsRef.current = 0;
          fetchMomentsForCategory(categoryAxis, driftTarget);
          return { categoryIndex: driftIdx, timeIndex: 0 };
        }
      }

      return { ...prev, timeIndex: newTimeIndex };
    });
  }, [categoryAxis, moments, cacheKey, fetchMomentsForCategory, pushTrail, getRecentCategories]);

  // DOWN = SURRENDER: bleed into adjacent category (organic)
  const goDown = useCallback((velocity: number = 0) => {
    pushTrail('down');
    setNavAction('down');
    consecutiveUpsRef.current = 0;

    setPosition(prev => {
      const cats = CATEGORY_PRESETS[categoryAxis];
      const currentCat = cats[prev.categoryIndex] || '';

      // Higher velocity = pick more exotic neighbor
      const exoticBias = Math.min(velocity / 3, 1);
      const targetCat = pickWeightedNeighbor(categoryAxis, currentCat, getRecentCategories(), exoticBias);
      const targetIdx = cats.indexOf(targetCat);

      if (targetIdx !== -1 && targetIdx !== prev.categoryIndex) {
        const targetKey = cacheKey(categoryAxis, targetCat);
        const targetMoments = moments.get(targetKey) || [];
        fetchMomentsForCategory(categoryAxis, targetCat);

        // Land at a random position in the target category
        const randomTime = targetMoments.length > 0
          ? Math.floor(Math.random() * targetMoments.length)
          : 0;

        return { categoryIndex: targetIdx, timeIndex: randomTime };
      }

      // Fallback: go back in time in current category
      return { ...prev, timeIndex: Math.max(prev.timeIndex - 1, 0) };
    });
  }, [categoryAxis, moments, cacheKey, fetchMomentsForCategory, pushTrail, getRecentCategories]);

  // LEFT = MEMORY: retrace trail with fading precision
  const goLeft = useCallback((_velocity: number = 0) => {
    setNavAction('left');
    consecutiveUpsRef.current = 0;

    const trailEntries = trailRef.current;

    if (trailEntries.length === 0) {
      // No trail: wrap to previous category (original behavior)
      pushTrail('left');
      setPosition(prev => ({
        categoryIndex: (prev.categoryIndex - 1 + categories.length) % categories.length,
        timeIndex: 0,
      }));
      return;
    }

    // Pop from trail
    const entry = trailEntries.pop()!;
    trailRef.current = [...trailEntries];
    setTrail([...trailRef.current]);

    const depth = MAX_TRAIL - trailEntries.length; // how far back we're going
    const cats = CATEGORY_PRESETS[categoryAxis];

    if (depth <= 3) {
      // EXACT: return to exact position
      setPosition({ categoryIndex: entry.categoryIndex, timeIndex: entry.timeIndex });
    } else if (depth <= 10) {
      // FUZZY: same category, but time drifts
      const key = cacheKey(entry.categoryAxis, entry.category);
      const catMoments = moments.get(key) || [];
      const drift = Math.floor((Math.random() - 0.5) * 4);
      const fuzzedTime = Math.max(0, Math.min(entry.timeIndex + drift, catMoments.length - 1));
      setPosition({ categoryIndex: entry.categoryIndex, timeIndex: fuzzedTime });
    } else {
      // APPROXIMATE: might land in adjacent category
      if (Math.random() < 0.4) {
        const adjCat = pickWeightedNeighbor(entry.categoryAxis, entry.category);
        const adjIdx = cats.indexOf(adjCat);
        if (adjIdx !== -1) {
          fetchMomentsForCategory(categoryAxis, adjCat);
          setPosition({ categoryIndex: adjIdx, timeIndex: 0 });
          return;
        }
      }
      setPosition({ categoryIndex: entry.categoryIndex, timeIndex: 0 });
    }
  }, [categoryAxis, categories.length, moments, cacheKey, fetchMomentsForCategory, pushTrail]);

  // RIGHT = DRIFT: explore somewhere new (weighted, avoids recent)
  const goRight = useCallback((velocity: number = 0) => {
    pushTrail('right');
    setNavAction('right');
    consecutiveUpsRef.current = 0;

    setPosition(prev => {
      const cats = CATEGORY_PRESETS[categoryAxis];
      const currentCat = cats[prev.categoryIndex] || '';

      // Higher velocity = more exotic drift
      const exoticBias = Math.min(0.3 + velocity / 3, 1);
      const driftTarget = pickWeightedNeighbor(categoryAxis, currentCat, getRecentCategories(), exoticBias);
      const driftIdx = cats.indexOf(driftTarget);

      if (driftIdx !== -1 && driftIdx !== prev.categoryIndex) {
        fetchMomentsForCategory(categoryAxis, driftTarget);
        return { categoryIndex: driftIdx, timeIndex: 0 };
      }

      // Fallback: next category
      return {
        categoryIndex: (prev.categoryIndex + 1) % cats.length,
        timeIndex: 0,
      };
    });
  }, [categoryAxis, fetchMomentsForCategory, pushTrail, getRecentCategories]);

  // TABS = HARD SHIFT: intentional dimension change
  const setCategoryAxis = useCallback((axis: CategoryAxis) => {
    pushTrail('tab');
    setNavAction('tab');
    consecutiveUpsRef.current = 0;
    setCategoryAxisState(axis);
    setPosition({ categoryIndex: 0, timeIndex: 0 });
  }, [pushTrail]);

  // COMPASS JUMP: direct jump to any category index
  const jumpToCategory = useCallback((index: number) => {
    const cats = CATEGORY_PRESETS[categoryAxis];
    if (index < 0 || index >= cats.length) return;
    pushTrail('right');
    setNavAction(index > position.categoryIndex ? 'left' : 'right');
    consecutiveUpsRef.current = 0;
    fetchMomentsForCategory(categoryAxis, cats[index]);
    setPosition({ categoryIndex: index, timeIndex: 0 });
  }, [categoryAxis, position.categoryIndex, fetchMomentsForCategory, pushTrail]);

  // ============================================
  // ENGAGEMENT
  // ============================================

  const recordPlay = useCallback(async (momentId: string) => {
    // v832: feed the engine — bumps the creator's session weight so
    // their next moment rises in the next page. markShown adds the
    // momentId to the dedup set so we don't surface it twice in the
    // same session even if it stays on a freshly-fetched page.
    let creator: string | undefined;
    for (const list of moments.values()) {
      const hit = list.find(m => m.id === momentId);
      if (hit) { creator = hit.creator_username || hit.creator_name; break; }
    }
    recordSessionPlay(creator);
    // v858: pass creator into markShown so the engine's last-N
    // ring buffer learns who's been on screen recently.
    markShown(momentId, creator);

    if (!supabase || !isSupabaseConfigured) return;
    try {
      await supabase.rpc('record_moment_play', {
        p_moment_id: momentId,
        p_tapped_full_song: false,
      });
    } catch {
      // Silent fail - engagement tracking is best-effort
    }
  }, [moments]);

  const recordOye = useCallback(async (momentId: string) => {
    // C2 fanout — feed the taste graph from Moments OYEs too.
    // Find the moment's parent_track_id by walking the fetched-moments map.
    // Cheap: Map is at most a few hundred rows in practice.
    let parentTrackId: string | undefined;
    let matched: Moment | undefined;
    for (const list of moments.values()) {
      const hit = list.find(m => m.id === momentId);
      if (hit) {
        matched = hit;
        parentTrackId = hit.parent_track_id;
        break;
      }
    }
    if (parentTrackId && matched) {
      // Route through the canonical OYE fanout so the moment reaction
      // contributes to favoriteArtists + recordRemoteSignal('react') just
      // like a music-player OYE does. Exactly ONE voyo_signals row written
      // per tap (matches C1 consolidation).
      try {
        const [{ oyo }] = await Promise.all([import('../services/oyo/index')]);
        oyo.onOye({
          id: parentTrackId,
          trackId: parentTrackId,
          title: matched.parent_track_title || matched.title,
          artist: matched.parent_track_artist || matched.creator_name || '',
          coverUrl: matched.thumbnail_url,
        } as never);
      } catch {
        // non-fatal — reaction increment below is the primary effect
      }
    }

    if (!supabase || !isSupabaseConfigured) return;
    try {
      // Known race: two rapid OYEs can both read voyo_reactions=N and
      // both write N+1, dropping one increment. Acceptable trade-off for
      // now — the voyo_signals fanout above is the taste-graph truth;
      // voyo_moments.voyo_reactions is a displayed counter, not a
      // source-of-truth. Follow-up ticket: add an atomic
      // increment_moment_reaction RPC (audit AUDIT-MOMENTS-1 finding #3).
      const { data: current } = await supabase
        .from('voyo_moments')
        .select('voyo_reactions')
        .eq('id', momentId)
        .maybeSingle();

      if (current) {
        await supabase
          .from('voyo_moments')
          .update({ voyo_reactions: (current.voyo_reactions || 0) + 1 })
          .eq('id', momentId);
      }
    } catch {
      // Silent fail
    }
  }, [moments]);

  const recordStar = useCallback(async (momentId: string, creatorUsername: string, stars: number) => {
    // v832: 1 star = follow, deliberate intent. Heavy positive in the
    // engine's session memory so this creator's other moments climb
    // immediately without waiting for the cross-session signals
    // hydration to repick them up.
    recordSessionStar(creatorUsername);

    if (!supabase || !isSupabaseConfigured) return;
    try {
      await supabase.from('voyo_stars').insert({
        moment_id: momentId,
        creator_username: creatorUsername,
        stars: Math.min(Math.max(stars, 1), 5),
      });
    } catch {
      // Silent fail - engagement is best-effort
    }
  }, []);

  // v832: dwell-incomplete = soft skip. Engine bumps creator weight
  // down a touch so the next page slightly de-prioritises them. Not
  // a hard ban — fast scrolls through familiar territory shouldn't
  // poison good creators.
  const recordSkip = useCallback((momentId: string) => {
    let creator: string | undefined;
    for (const list of moments.values()) {
      const hit = list.find(m => m.id === momentId);
      if (hit) { creator = hit.creator_username || hit.creator_name; break; }
    }
    recordSessionSkip(creator);
  }, [moments]);

  const displayName = useCallback((key: string) => DISPLAY_NAMES[key] || key, []);

  return {
    currentMoment,
    position,
    categoryAxis,
    categories,
    currentCategory,
    displayName,
    goUp,
    goDown,
    goLeft,
    goRight,
    setCategoryAxis,
    jumpToCategory,
    moments,
    loading,
    totalInCategory,
    navAction,
    trail,
    recordPlay,
    recordOye,
    recordStar,
    recordSkip,
    fetchMomentsForCategory,
    cacheKey,
  };
}

export default useMoments;
