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
import type { Moment } from '../services/momentsService';

// ============================================
// TYPES
// ============================================

export type CategoryAxis = 'countries' | 'vibes' | 'genres';

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
  fetchMomentsForCategory: (axis: CategoryAxis, category: string, offset?: number) => Promise<void>;
  cacheKey: (axis: CategoryAxis, cat: string) => string;
}

// ============================================
// FIXED CATEGORY PRESETS
// ============================================

export const CATEGORY_PRESETS: Record<CategoryAxis, string[]> = {
  countries: [
    'nigeria', 'ghana', 'kenya', 'south africa', 'senegal',
    'algeria', 'uk', 'usa', 'france', 'diaspora',
  ],
  vibes: [
    'dance', 'comedy', 'live', 'fashion', 'original', 'cover', 'reaction',
  ],
  genres: [
    '#music', '#afrobeats', '#amapiano', '#afrodance',
    '#afrodaily', '#dance', '#dj', '#trending',
  ],
};

// Display names for UI (map internal keys to pretty labels)
const DISPLAY_NAMES: Record<string, string> = {
  'nigeria': 'Nigeria', 'ghana': 'Ghana', 'kenya': 'Kenya',
  'south africa': 'South Africa', 'senegal': 'Senegal', 'algeria': 'Algeria',
  'uk': 'UK', 'usa': 'USA', 'france': 'France', 'diaspora': 'Diaspora',
  'dance': 'Dance', 'comedy': 'Comedy', 'live': 'Live', 'fashion': 'Fashion',
  'original': 'Original', 'cover': 'Cover', 'reaction': 'Reaction',
  '#music': 'Music', '#afrobeats': 'Afrobeats', '#amapiano': 'Amapiano',
  '#afrodance': 'Afro Dance', '#afrodaily': 'Afro Daily', '#dance': 'Dance',
  '#dj': 'DJ', '#trending': 'Trending',
};

const MOMENTS_PER_PAGE = 20;
const MAX_TRAIL = 50;
const AUTO_DRIFT_THRESHOLD = 5; // consecutive UPs before drift chance
const AUTO_DRIFT_CHANCE = 0.3;

// ============================================
// ADJACENCY MAPS (weighted neighbors for drift/bleed)
// ============================================

const ADJACENCY: Record<CategoryAxis, Record<string, Record<string, number>>> = {
  countries: {
    'nigeria':      { 'ghana': 0.3, 'senegal': 0.2, 'uk': 0.15, 'diaspora': 0.15, 'usa': 0.1, 'south africa': 0.1 },
    'ghana':        { 'nigeria': 0.3, 'senegal': 0.2, 'uk': 0.15, 'diaspora': 0.15, 'south africa': 0.1, 'kenya': 0.1 },
    'kenya':        { 'south africa': 0.3, 'nigeria': 0.2, 'ghana': 0.15, 'diaspora': 0.15, 'uk': 0.1, 'usa': 0.1 },
    'south africa': { 'kenya': 0.3, 'nigeria': 0.2, 'ghana': 0.15, 'diaspora': 0.15, 'uk': 0.1, 'usa': 0.1 },
    'senegal':      { 'nigeria': 0.25, 'ghana': 0.2, 'france': 0.2, 'algeria': 0.15, 'diaspora': 0.1, 'uk': 0.1 },
    'algeria':      { 'france': 0.3, 'senegal': 0.2, 'nigeria': 0.15, 'diaspora': 0.15, 'uk': 0.1, 'usa': 0.1 },
    'uk':           { 'nigeria': 0.25, 'ghana': 0.2, 'diaspora': 0.2, 'france': 0.15, 'usa': 0.1, 'south africa': 0.1 },
    'usa':          { 'diaspora': 0.3, 'nigeria': 0.2, 'uk': 0.2, 'ghana': 0.1, 'south africa': 0.1, 'france': 0.1 },
    'france':       { 'senegal': 0.25, 'algeria': 0.25, 'diaspora': 0.2, 'uk': 0.15, 'nigeria': 0.1, 'ghana': 0.05 },
    'diaspora':     { 'nigeria': 0.2, 'usa': 0.2, 'uk': 0.2, 'ghana': 0.15, 'south africa': 0.15, 'france': 0.1 },
  },
  vibes: {
    'dance':    { 'live': 0.3, 'fashion': 0.2, 'original': 0.2, 'comedy': 0.15, 'cover': 0.1, 'reaction': 0.05 },
    'comedy':   { 'reaction': 0.3, 'live': 0.25, 'dance': 0.2, 'original': 0.15, 'cover': 0.1 },
    'live':     { 'dance': 0.3, 'comedy': 0.2, 'original': 0.2, 'cover': 0.15, 'fashion': 0.1, 'reaction': 0.05 },
    'fashion':  { 'dance': 0.3, 'original': 0.25, 'live': 0.2, 'comedy': 0.1, 'cover': 0.1, 'reaction': 0.05 },
    'original': { 'cover': 0.25, 'dance': 0.2, 'live': 0.2, 'fashion': 0.15, 'comedy': 0.1, 'reaction': 0.1 },
    'cover':    { 'original': 0.3, 'live': 0.25, 'dance': 0.2, 'reaction': 0.15, 'comedy': 0.1 },
    'reaction': { 'comedy': 0.3, 'cover': 0.2, 'live': 0.2, 'original': 0.15, 'dance': 0.1, 'fashion': 0.05 },
  },
  genres: {
    '#music':     { '#afrobeats': 0.25, '#trending': 0.2, '#dj': 0.2, '#amapiano': 0.15, '#afrodance': 0.1, '#afrodaily': 0.1 },
    '#afrobeats': { '#amapiano': 0.25, '#afrodance': 0.2, '#music': 0.2, '#trending': 0.15, '#afrodaily': 0.1, '#dj': 0.1 },
    '#amapiano':  { '#afrobeats': 0.25, '#afrodance': 0.25, '#dance': 0.2, '#dj': 0.15, '#music': 0.1, '#trending': 0.05 },
    '#afrodance': { '#amapiano': 0.25, '#dance': 0.25, '#afrobeats': 0.2, '#trending': 0.15, '#music': 0.1, '#afrodaily': 0.05 },
    '#afrodaily': { '#afrobeats': 0.25, '#music': 0.2, '#trending': 0.2, '#afrodance': 0.15, '#amapiano': 0.1, '#dance': 0.1 },
    '#dance':     { '#afrodance': 0.3, '#amapiano': 0.25, '#dj': 0.2, '#trending': 0.15, '#afrobeats': 0.1 },
    '#dj':        { '#dance': 0.25, '#amapiano': 0.2, '#music': 0.2, '#trending': 0.2, '#afrobeats': 0.1, '#afrodance': 0.05 },
    '#trending':  { '#music': 0.2, '#afrobeats': 0.2, '#dance': 0.15, '#dj': 0.15, '#afrodance': 0.15, '#amapiano': 0.15 },
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
      if (!supabase || !isSupabaseConfigured) return;

      const key = cacheKey(axis, category);

      // Skip if already fetching this exact key
      if (fetchingRef.current.has(key) && offset === 0) return;
      // Skip if already fetched initial page (offset 0)
      if (fetchedRef.current.has(key) && offset === 0) return;

      fetchingRef.current.add(key);
      if (offset === 0) setLoading(true);

      try {
        let query = supabase
          .from('voyo_moments')
          .select('*')
          .eq('is_active', true)
          .order('discovered_at', { ascending: false })
          .range(offset, offset + MOMENTS_PER_PAGE - 1);

        // Apply filter based on which axis we are on
        if (axis === 'countries') {
          query = query.contains('cultural_tags', [category]);
        } else if (axis === 'vibes') {
          // Vibes filter by content_type column (dance, comedy, live, etc.)
          query = query.eq('content_type', category);
        } else {
          // Genres filter by vibe_tags array (hashtags like #afrobeats)
          query = query.contains('vibe_tags', [category]);
        }

        const { data, error } = await query;

        if (error) {
          console.error(`[useMoments] Fetch error for ${category}:`, error.message);
          return;
        }

        const fetched = (data || []) as Moment[];

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
        console.error('[useMoments] Fetch exception:', err);
      } finally {
        fetchingRef.current.delete(key);
        if (offset === 0) setLoading(false);
      }
    },
    [cacheKey]
  );

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
    if (!supabase || !isSupabaseConfigured) return;
    try {
      await supabase.rpc('record_moment_play', {
        p_moment_id: momentId,
        p_tapped_full_song: false,
      });
    } catch {
      // Silent fail - engagement tracking is best-effort
    }
  }, []);

  const recordOye = useCallback(async (momentId: string) => {
    if (!supabase || !isSupabaseConfigured) return;
    try {
      // Increment voyo_reactions
      const { data: current } = await supabase
        .from('voyo_moments')
        .select('voyo_reactions')
        .eq('id', momentId)
        .single();

      if (current) {
        await supabase
          .from('voyo_moments')
          .update({ voyo_reactions: (current.voyo_reactions || 0) + 1 })
          .eq('id', momentId);
      }
    } catch {
      // Silent fail
    }
  }, []);

  const recordStar = useCallback(async (momentId: string, creatorUsername: string, stars: number) => {
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
    fetchMomentsForCategory,
    cacheKey,
  };
}

export default useMoments;
