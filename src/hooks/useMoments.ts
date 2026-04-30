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
  clearCooldownForMoment,
  recordSessionStar,
  markShown,
} from '../services/momentsEngine';

// Circuit breaker: voyo_moments queries time out when table lacks indexes.
// After first timeout, stop making requests to prevent repeated 500s in console.
let _momentsBlocked = false;

// ============================================
// TYPES
// ============================================

// v860/v865 — Moments top-row. Four modes, each pulling a DIFFERENT
// shape of content. Order is Music / Live / Vibes Now / Friends —
// see TOP_MODE_LABELS below for the rationale.
//
//   'music'     : MUSIC-FIRST discovery. Filters to moments with a
//                 parent_track_id (the 21% of the catalog that
//                 actually bridges to a song). Sub-cats are
//                 content_type within that subset (Songs / Dance /
//                 Performances / Covers). The tab Dash calls
//                 "moments through music".
//   'live'      : virality cuts (pulse / rising / gems). Heat layer.
//                 No fresh-ingest dependency — works on the static
//                 catalog.
//   'vibes-now' : current emotional axes (dance/comedy/live/etc),
//                 quality-weighted, biased by what you're playing.
//   'friends'   : creators you've starred + session-engaged.
//                 Social graph view, empties shows the follow hint.
//
// v911 — Travel filtering rewritten on the REAL catalog signal.
// Diagnostic 2026-04-30: voyo_moments has a populated cultural_tags
// column (string[]) with country/region tokens. Sample volumes:
//   nigeria 2170, west-africa 2027, diaspora 1774, usa 1473,
//   angola 964, lusophone-africa 927, uk 253, africa 188,
//   ghana 62, senegal 46, kenya 54, tanzania 26, mali 4, guinea 5
// The v903/v909 creator-name approach was off — none of artistTiers'
// canonical names are in the moments catalog (creators are
// Instagram-handle-shaped: ichievoodoo, only1daddyess, etc.). The
// real country signal is cultural_tags overlap.
// Sub-cats curated to volume: thin-but-symbolic (Senegal/Ghana) kept
// for cultural relevance + bleed/rescue fills the page; near-zero
// countries (Mali 4, Guinea 5, Côte d'Ivoire 0) dropped — surfacing
// a sub-cat that cannot fill is worse UX than not surfacing it.
const COUNTRY_TAG_MAP: Record<string, string[]> = {
  'nigeria':     ['nigeria', 'naija'],
  'senegal':     ['senegal'],
  'ghana':       ['ghana'],
  'angola':      ['angola'],
  'west-africa': ['west-africa'],
};

// CategoryAxis — v902 (Dash 2026-04-29): top-bar reorg.
//   trends   the TikTok-style "For You" explore feed (broadest pool)
//   travel   geo-organized social-media explore (country sub-cats)
//   live     virality cuts (currently faded/disabled in UI)
//   vibes    music-bridged moments (was 'music')
//   friends  engaged-creators only (private space)
// 'vibes-now' retired — its content_type filtering folded into Trends.
export type CategoryAxis = 'trends' | 'travel' | 'live' | 'vibes' | 'friends';

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
  // v910 — Trends: the TikTok-style For You explore feed. Sub-cats
  // calibrated to catalog volume (live diagnostic 2026-04-30):
  //   all      6788 moments  (broadest pool)
  //   dance    1040
  //   comedy    410
  //   fashion    68
  // Dropped 'reaction' (only 11 moments — would always trigger
  // broad-rescue; better to not surface a sub-cat that can't fill).
  'trends': [
    'all', 'dance', 'comedy', 'fashion',
  ],
  // v911 — Travel sub-cats keyed to cultural_tags coverage in the
  // live catalog. Volumes (April 2026):
  //   nigeria 2170, west-africa 2027, angola 964, ghana 62, senegal 46
  // Mali / Guinea / Ivory-Coast dropped (all <10 — under one creator-cap).
  'travel': [
    'nigeria', 'senegal', 'ghana', 'angola', 'west-africa',
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
  // v902 Vibes (renamed from 'music') — moments WITH a parent_track_id,
  // bucketed by content_type. Songs (originals) is the largest pool;
  // Dance/Performances carry the music-driven physical vibes. The
  // golden tab in the moments header. Behavior unchanged from the old
  // 'music' axis: dwell auto-plays the parent track.
  'vibes': [
    'original', 'dance', 'live',
  ],
  // Friends — private space for moments by creators the user has
  // engaged with (sessionStarred + strong session-weight). Single
  // chip until the social graph fills out.
  'friends': [
    'all',
  ],
};

// Display names for UI (map internal keys to pretty labels)
const DISPLAY_NAMES: Record<string, string> = {
  // Content-type labels (used by Trends sub-cats too)
  'dance': 'Dance', 'comedy': 'Comedy', 'live': 'Live', 'fashion': 'Fashion',
  'original': 'Original', 'cover': 'Cover', 'reaction': 'Reaction',
  // Trends 'all' chip
  'all': 'For You',
  // Live sub-categories (virality cuts)
  'pulse': 'Pulse', 'rising': 'Rising', 'gems': 'Gems',
  // Travel sub-cats (v911 — cultural_tags-keyed)
  'nigeria':     'Nigeria',
  'senegal':     'Sénégal',
  'ghana':       'Ghana',
  'angola':      'Angola',
  'west-africa': 'West Africa',
};

// v902 — labels for the 5 top modes. Trends leads as the explore
// surface; Travel next as the geo-explore. Live faded (no click)
// in the UI for now. Vibes is the golden music-bridged tab. Friends
// is the private engaged-only lane.
export const TOP_MODE_LABELS: Record<CategoryAxis, string> = {
  'trends':  'Trends',
  'travel':  'Travel',
  'live':    'Live',
  'vibes':   'Vibes',
  'friends': 'Friends',
};

// When in Vibes mode (was Music), override DISPLAY_NAMES so 'live'
// sub-cat reads as "Performances" (avoids label collision with the
// top-mode 'Live' tab). Other content_types reuse existing labels.
const MUSIC_SUB_LABELS: Record<string, string> = {
  'original': 'Songs',
  'dance':    'Dance',
  'live':     'Performances',
  'cover':    'Covers',
};

const MOMENTS_PER_PAGE = 20;
const MAX_TRAIL = 50;
// v905 (Dash 2026-04-29 "20 30 cards before drifts, and it keeps
// spinning"): bumped from 5/0.3 → 25/0.5 so the user spends real
// time in a lane (~25 cards in-vibe) before the engine starts mixing
// adjacent sub-cats. Higher chance once threshold is crossed so the
// drift actually fires when the user lingers.
const AUTO_DRIFT_THRESHOLD = 25;
const AUTO_DRIFT_CHANCE = 0.5;

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
// v910 — bumped 0.6 → 0.75. Bleed/rescue cascade fires earlier so
// thin lanes (fashion 68, cover 51 etc) reach a full page reliably.
// Healthy lanes are unaffected (they exceed both thresholds).
const BLEED_THRESHOLD_RATIO = 0.75;

// ============================================
// ADJACENCY MAPS (weighted neighbors for drift/bleed)
// ============================================

// v860/v865 — adjacency keyed by top-mode. Drift (left/right)
// traverses these edges within the current top mode. Friends has
// a single sub-cat ('all') so drift is a no-op there.
const ADJACENCY: Record<CategoryAxis, Record<string, Record<string, number>>> = {
  // Trends — drift across content-type lenses. 'all' is the broadest
  // hub; specific lenses bleed into adjacent vibes.
  // v910: 'reaction' edges removed (sub-cat retired).
  'trends': {
    'all':     { 'dance': 0.4, 'comedy': 0.35, 'fashion': 0.25 },
    'dance':   { 'all': 0.45, 'fashion': 0.3, 'comedy': 0.25 },
    'comedy':  { 'all': 0.5, 'dance': 0.3, 'fashion': 0.2 },
    'fashion': { 'all': 0.5, 'dance': 0.3, 'comedy': 0.2 },
  },
  // Travel — drift across cultural-tag regions. v911 weights:
  // anglophone (Nigeria/Ghana) cluster, Senegal francophone bridge,
  // Angola lusophone outpost, west-africa as the meta hub.
  'travel': {
    'nigeria':     { 'ghana': 0.4, 'west-africa': 0.35, 'senegal': 0.15, 'angola': 0.1 },
    'senegal':     { 'west-africa': 0.45, 'ghana': 0.2, 'nigeria': 0.2, 'angola': 0.15 },
    'ghana':       { 'nigeria': 0.4, 'west-africa': 0.3, 'senegal': 0.2, 'angola': 0.1 },
    'angola':      { 'west-africa': 0.4, 'nigeria': 0.3, 'ghana': 0.15, 'senegal': 0.15 },
    'west-africa': { 'nigeria': 0.4, 'ghana': 0.25, 'senegal': 0.2, 'angola': 0.15 },
  },
  'live': {
    'pulse':  { 'rising': 0.7, 'gems': 0.3 },
    'rising': { 'pulse': 0.4, 'gems': 0.6 },
    'gems':   { 'rising': 0.6, 'pulse': 0.4 },
  },
  // Vibes (renamed from music) — sub-cats drift between musical
  // expressions. Songs ↔ Performances are closest (both heavy-music).
  'vibes': {
    'original': { 'live': 0.55, 'dance': 0.45 },
    'dance':    { 'original': 0.6, 'live': 0.4 },
    'live':     { 'original': 0.65, 'dance': 0.35 },
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
  // v902 — default landing on Vibes (renamed from 'music'). VOYO
  // is music-first; the music-bridged moments (21% of catalog with
  // a parent_track_id) feed the auto-play-on-dwell flow. Trends
  // sits to the left for the broader explore feel.
  const [categoryAxis, setCategoryAxisState] = useState<CategoryAxis>('vibes');
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

          if (axis === 'vibes') {
            // v902 Vibes (renamed from 'music') — moments WITH a
            // parent_track_id only, bucketed by content_type. The
            // 79% of catalog without a parent_track is filtered out
            // here so this lane is exclusively music-bridged.
            q = q.not('parent_track_id', 'is', null).eq('content_type', category);
          } else if (axis === 'trends') {
            // v902 Trends — TikTok-style For You. 'all' = no
            // content_type filter (broadest pool, virality-ranked).
            // Specific sub-cats narrow to a content_type lens.
            if (category !== 'all') {
              q = q.eq('content_type', category);
            }
          } else if (axis === 'travel') {
            // v911 Travel — cultural_tags overlap. The catalog has a
            // populated cultural_tags column with real country/region
            // tokens, so this is the strict-but-actually-hits filter.
            const tags = COUNTRY_TAG_MAP[category];
            if (!tags || tags.length === 0) return null;
            q = q.overlaps('cultural_tags', tags);
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
        // (Initial single-pass rank moved into the v904 fill block
        //  below — see Phase A / Phase B / final rank.)

        // v859 CROSS-CATEGORY BLEED. If the hard cap left the page
        // short (catalog too monoculture), pull from adjacent
        // categories using the existing weighted ADJACENCY map. The
        // engine re-ranks the unified candidate pool so bled-in
        // moments compete fairly with the primary category's. User
        // never sees a half-empty feed even when the chosen vibe is
        // dominated by one creator.
        // v904 — TWO-PHASE FILL when the primary query came up short.
        // Phase A: bleed from neighbor sub-cats within the same axis
        //   (trends content-type lenses, vibes content-type lenses,
        //    travel neighboring countries, live neighboring virality
        //    cuts). Friends stays narrow on purpose.
        // Phase B: if STILL short, broad-rescue with NO axis filter.
        //   Pulls the top virality-ranked moments site-wide and
        //   supplements. Re-rank gives them a fair shake; primary
        //   matches still bubble to the top via the seed/taste signals.
        // Net effect: every lane reaches MOMENTS_PER_PAGE in practice
        // — the cube never sits half-empty even when a country / cut
        // / sub-cat is sparse in the active catalog.
        const seenIds = new Set(raw.map(m => m.id));
        const filledRaw: Moment[] = [...raw];

        const tooShort = () =>
          filledRaw.length < Math.floor(MOMENTS_PER_PAGE * BLEED_THRESHOLD_RATIO);

        if (tooShort()) {
          // Phase A — neighbor-cat bleed.
          const neighbours = ADJACENCY[axis]?.[category] || {};
          const neighborCats = Object.entries(neighbours)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([cat]) => cat);

          for (const nc of neighborCats) {
            try {
              let nq = supabase!
                .from('voyo_moments')
                .select('*')
                .eq('is_active', true)
                .order('virality_score', { ascending: false, nullsFirst: false })
                .order('discovered_at', { ascending: false })
                .range(0, MOMENTS_PER_PAGE * 2 - 1);

              if (axis === 'trends' && nc !== 'all') {
                nq = nq.eq('content_type', nc);
              } else if (axis === 'vibes') {
                nq = nq.not('parent_track_id', 'is', null).eq('content_type', nc);
              } else if (axis === 'travel') {
                const tags = COUNTRY_TAG_MAP[nc];
                if (!tags || tags.length === 0) continue;
                nq = nq.overlaps('cultural_tags', tags);
              } else if (axis === 'live') {
                const liveMin: Record<string, number> = { 'pulse': 120000, 'rising': 20000, 'gems': 2500 };
                const liveMax: Record<string, number | null> = { 'pulse': null, 'rising': 120000, 'gems': 20000 };
                nq = nq.gte('virality_score', liveMin[nc] ?? 1000);
                const mx = liveMax[nc];
                if (mx !== null && mx !== undefined) nq = nq.lt('virality_score', mx);
              } else {
                continue; // friends — no bleed
              }

              const { data: nd } = await nq;
              for (const m of (nd || []) as Moment[]) {
                if (m?.id && !seenIds.has(m.id)) {
                  seenIds.add(m.id);
                  filledRaw.push(m);
                }
              }
            } catch { /* one neighbor failing shouldn't stall the page */ }
          }
        }

        // Phase B — broad rescue. Friends excluded (the private-space
        // contract is to stay strictly engaged-creator-only, and an
        // empty Friends lane signals "follow some creators" instead of
        // pouring in random content).
        if (tooShort() && axis !== 'friends') {
          try {
            const broadQ = supabase!
              .from('voyo_moments')
              .select('*')
              .eq('is_active', true)
              .order('virality_score', { ascending: false, nullsFirst: false })
              .order('discovered_at', { ascending: false })
              .range(0, MOMENTS_PER_PAGE * 3 - 1);
            const { data: broadData } = await broadQ;
            for (const m of (broadData || []) as Moment[]) {
              if (m?.id && !seenIds.has(m.id)) {
                seenIds.add(m.id);
                filledRaw.push(m);
              }
            }
          } catch { /* broad-rescue failure leaves whatever Phase A pulled */ }
        }

        // Final rank over the unified pool (primary + bleed + rescue).
        // filledRaw === raw when both phases were no-ops, so this is
        // also the canonical single-pass rank for healthy lanes.
        const fetched = rankMoments(filledRaw, rankCtx);

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
  // NAVIGATION (v862 grammar per Dash 2026-04-29:
  //   "DOWN = forward feed, UP = more of this / previous,
  //    LEFT/RIGHT = invisible drift through diversity")
  // ============================================

  // UP = MORE OF THIS / REWIND. Steps backward through the trail
  // (the moment the user just saw). When trail is empty, falls
  // back to timeIndex - 1 in the current sub-cat. The "more of
  // this" feeling is reinforced by the cross-surface seed +
  // similarity boost (engine already scores parent_track + tags).
  const goUp = useCallback((_velocity: number = 0) => {
    setNavAction('up');
    consecutiveUpsRef.current = 0;

    const trailEntries = trailRef.current;
    if (trailEntries.length > 0) {
      const entry = trailEntries.pop()!;
      trailRef.current = [...trailEntries];
      setTrail([...trailRef.current]);
      // Return to the recent position from the trail.
      setPosition({ categoryIndex: entry.categoryIndex, timeIndex: entry.timeIndex });
      return;
    }

    // No trail — step back one in current sub-cat.
    pushTrail('up');
    setPosition(prev => ({ ...prev, timeIndex: Math.max(prev.timeIndex - 1, 0) }));
  }, [pushTrail]);

  // DOWN = FORWARD FEED. Next moment in the current sub-category.
  // This is the default consumption gesture. Auto-paginates the
  // category page when the user nears the end. Light auto-drift
  // chance kicks in after long stretches in same lane to keep
  // rotation organic without the user having to swipe sideways.
  const goDown = useCallback((velocity: number = 0) => {
    pushTrail('down');
    setNavAction('down');
    consecutiveUpsRef.current += 1;

    setPosition(prev => {
      const cats = CATEGORY_PRESETS[categoryAxis];
      const cat = cats[prev.categoryIndex] || '';
      const key = cacheKey(categoryAxis, cat);
      const categoryMoments = moments.get(key) || [];

      const skip = velocity > 1.5 ? Math.min(Math.floor(velocity), 3) : 1;
      let newTimeIndex = Math.min(prev.timeIndex + skip, categoryMoments.length - 1);
      newTimeIndex = Math.max(newTimeIndex, 0);

      // Auto-paginate near end
      if (newTimeIndex >= categoryMoments.length - 3 && cat) {
        fetchMomentsForCategory(categoryAxis, cat, categoryMoments.length);
      }

      // Auto-drift after long stretches in same lane (subtle)
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

  // v862 LEFT/RIGHT = INVISIBLE DRIFT through adjacent sub-categories
  // within the current top mode. Per Dash's "invisible drift" — the
  // user doesn't see the lane change ticker; only TAP reveals
  // current position. Both gestures use ADJACENCY-weighted random,
  // they just differ in bias:
  //   LEFT  : "familiar" drift — low exoticBias, prefers neighbors
  //           similar to recent ones (still in the comfort zone)
  //   RIGHT : "discover" drift — high exoticBias, prefers
  //           less-recent neighbors (push outward into unknowns)
  // pushTrail keeps the breadcrumbs so UP can rewind across drifts.
  const goLeft = useCallback((velocity: number = 0) => {
    pushTrail('left');
    setNavAction('left');
    consecutiveUpsRef.current = 0;

    setPosition(prev => {
      const cats = CATEGORY_PRESETS[categoryAxis];
      const currentCat = cats[prev.categoryIndex] || '';
      // Familiar drift — low exoticBias, gravitates toward recent.
      const exoticBias = Math.max(0, 0.15 - velocity / 8);
      const target = pickWeightedNeighbor(categoryAxis, currentCat, getRecentCategories(), exoticBias);
      const idx = cats.indexOf(target);
      if (idx !== -1 && idx !== prev.categoryIndex) {
        fetchMomentsForCategory(categoryAxis, target);
        return { categoryIndex: idx, timeIndex: 0 };
      }
      // Fallback: previous in preset list.
      return {
        categoryIndex: (prev.categoryIndex - 1 + cats.length) % cats.length,
        timeIndex: 0,
      };
    });
  }, [categoryAxis, fetchMomentsForCategory, pushTrail, getRecentCategories]);

  // RIGHT = DISCOVER DRIFT — exotic-biased neighbor, pushes outward.
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
    // v861: OYE'd moments are EXEMPT from cooldown — love can
    // resurface. Removes from the cross-session 48h penalty.
    clearCooldownForMoment(momentId);
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

  // v865 — when Music mode is active, override the sub-cat label
  // for 'live' so it reads "Performances" (not the top-mode "Live").
  // Other sub-cats fall through to DISPLAY_NAMES.
  const displayName = useCallback(
    (key: string) => {
      if (categoryAxis === 'vibes' && MUSIC_SUB_LABELS[key]) return MUSIC_SUB_LABELS[key];
      return DISPLAY_NAMES[key] || key;
    },
    [categoryAxis],
  );

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
