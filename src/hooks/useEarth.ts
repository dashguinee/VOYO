import { useState, useRef, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Moment } from '../types/moments';

export type EarthDir = 'up' | 'down' | 'left' | 'right';

// Cultural compass — real DB tag values from voyo_moments survey
const WEST_TAGS = [
  'nigeria', 'naija', 'west-africa', 'ghana', 'senegal', 'guinea',
  'cameroon', 'mali', 'ivory-coast', 'diaspora', 'usa', 'uk', 'france', 'caribbean',
];
const EAST_TAGS = [
  'east-africa', 'kenya', 'tanzania', 'ethiopia', 'uganda',
  'south-africa', 'southern-africa', 'mzansi', 'angola', 'mozambique',
  'lusophone-africa', 'algeria', 'north-africa', 'cape-verde',
];

const PAGE = 30;

async function queryMoments(dir: EarthDir, seen: Set<string>): Promise<Moment[]> {
  if (!supabase || !isSupabaseConfigured) return [];

  let q = supabase.from('voyo_moments').select('*').eq('is_active', true).limit(PAGE);

  switch (dir) {
    case 'up':
      // THE FLOOR — hottest moments by composite heat
      q = q.order('heat_score', { ascending: false });
      break;
    case 'down':
      // THE VAULT — fresh content with low VOYO plays (undiscovered)
      q = q.lte('voyo_plays', 5).order('discovered_at', { ascending: false });
      break;
    case 'left':
      // WEST — Nigeria, Ghana, Senegal, Atlantic diaspora
      q = q.overlaps('cultural_tags', WEST_TAGS).order('virality_score', { ascending: false });
      break;
    case 'right':
      // EAST — East + Southern + Lusophone Africa
      q = q.overlaps('cultural_tags', EAST_TAGS).order('virality_score', { ascending: false });
      break;
  }

  const { data } = await q;
  return ((data || []) as Moment[]).filter(m => !seen.has(m.id));
}

export function useEarth() {
  const [current, setCurrent] = useState<Moment | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [lastDir, setLastDir] = useState<EarthDir | null>(null);
  const [loading, setLoading] = useState(true);

  const seen = useRef(new Set<string>());
  const trail = useRef<Moment[]>([]);
  const pools = useRef<Partial<Record<EarthDir, Moment[]>>>({});
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pickFromPool = (dir: EarthDir): Moment | null => {
    const fresh = (pools.current[dir] || []).filter(m => !seen.current.has(m.id));
    if (!fresh.length) return null;
    return fresh[Math.floor(Math.random() * Math.min(5, fresh.length))];
  };

  const prefetch = useCallback(async (dir: EarthDir) => {
    const fresh = (pools.current[dir] || []).filter(m => !seen.current.has(m.id));
    if (fresh.length > 3) return;
    const results = await queryMoments(dir, seen.current);
    pools.current[dir] = results;
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [fire, west] = await Promise.all([
        queryMoments('up', seen.current),
        queryMoments('left', seen.current),
      ]);
      pools.current.up = fire;
      pools.current.left = west;

      const first = fire[0] || west[0] || null;
      if (first) {
        seen.current.add(first.id);
        trail.current = [first];
        setCurrent(first);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const navigate = useCallback(async (dir: EarthDir) => {
    if (transitioning) return;

    let pick = pickFromPool(dir);
    if (!pick) {
      const fresh = await queryMoments(dir, seen.current);
      pools.current[dir] = fresh;
      pick = fresh[0] || null;
    }
    if (!pick) return;

    setTransitioning(true);
    setLastDir(dir);

    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    transitionTimer.current = setTimeout(() => {
      seen.current.add(pick!.id);
      trail.current.push(pick!);
      if (trail.current.length > 50) trail.current.shift();
      setCurrent(pick!);
      setTransitioning(false);
    }, 320);

    void prefetch(dir);
  }, [transitioning, prefetch]);

  const recordPlay = useCallback(async (momentId: string) => {
    if (!supabase || !isSupabaseConfigured) return;
    try {
      await supabase.rpc('record_moment_play', {
        p_moment_id: momentId,
        p_tapped_full_song: false,
      });
    } catch { /* best-effort */ }
  }, []);

  const recordOye = useCallback(async (momentId: string) => {
    // Route through OYO taste graph if the moment has a linked track
    const moment = trail.current.find(m => m.id === momentId) ?? (current?.id === momentId ? current : null);
    if (moment?.parent_track_id) {
      try {
        const [{ oyo }] = await Promise.all([import('../services/oyo/index')]);
        oyo.onOye({
          id: moment.parent_track_id,
          trackId: moment.parent_track_id,
          title: moment.parent_track_title || moment.title,
          artist: moment.parent_track_artist || moment.creator_name || '',
          coverUrl: moment.thumbnail_url,
        } as never);
      } catch { /* non-fatal */ }
    }

    if (!supabase || !isSupabaseConfigured) return;
    try {
      const { data: cur } = await supabase
        .from('voyo_moments')
        .select('voyo_reactions')
        .eq('id', momentId)
        .maybeSingle();
      if (cur) {
        await supabase
          .from('voyo_moments')
          .update({ voyo_reactions: (cur.voyo_reactions || 0) + 1 })
          .eq('id', momentId);
      }
    } catch { /* best-effort */ }
  }, [current]);

  return {
    current,
    transitioning,
    lastDir,
    loading,
    loadInitial,
    navigate,
    recordPlay,
    recordOye,
  };
}
