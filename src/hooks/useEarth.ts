import { useState, useRef, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { getInsights } from '../services/oyoDJ';
import { rankMoments, markShown, clearCooldownForMoment } from '../services/momentsEngine';
import type { Moment } from '../types/moments';

export type EarthDir = 'up' | 'down' | 'left' | 'right';

// ── Genre → Longitude Map ─────────────────────────────────────────────────
// Maps primary_genre to the center longitude of its origin region.
// Used as the geographic coordinate for the Moments Compass.
// Left/right swipes drift this longitude; up/down changes depth (specificity).
const GENRE_GEO_MAP: Record<string, number> = {
  // Senegambia -17°
  mbalax: -17, 'wolof-pop': -17,

  // Guinea / West Atlantic -12°
  'guinea-romance': -12,

  // Mali / Sahel -8°
  wassoulou: -8, gnawa: -8, 'blues-mandingo': -8,

  // Ivory Coast / Liberia -5°
  'coupe-decale': -5, 'coupé-décalé': -5, zouglou: -5, chaabi: -5,

  // Ghana -1°
  highlife: -1, hiplife: -1, 'palm-wine': -1,

  // Nigeria / Naija 5°
  afrobeats: 5, afropop: 5, 'naija-party': 5, fuji: 5, juju: 5,
  'afro-trap': 5, 'afro-r&b': 5, 'afro-soul': 5, afroswing: 5, rai: 5,

  // Cameroon 11°
  makossa: 11, bikutsi: 11,

  // Congo / Central Africa 18°
  soukous: 18, ndombolo: 18, congolese: 18, rumba: 15,

  // Angola 14°
  kuduro: 14, semba: 14, kizomba: 14, 'afro-house': 14,

  // South Africa 28°
  amapiano: 28, gqom: 28, mzansi: 28, kwaito: 25,

  // East Africa 36°
  'bongo-flava': 35, benga: 37, taarab: 40, 'ethio-jazz': 38,

  // Diaspora / Global -77°
  reggae: -77, dancehall: -77, 'afro-diaspora': -77,

  // Fallbacks
  world: 0, other: 0, tropical: 0,
};

// ── Geographic Clusters ───────────────────────────────────────────────────
// Each cluster anchors a longitude and owns the cultural_tags for that zone.
// queryMoments resolves clusters within a radius derived from compassDepth.
interface GeoCluster {
  lon: number;
  label: string;
  tags: string[];
}

const GEO_CLUSTERS: GeoCluster[] = [
  { lon: -77, label: 'DIASPORA',      tags: ['diaspora', 'caribbean', 'usa', 'uk', 'france'] },
  { lon: -17, label: 'SENEGAMBIA',    tags: ['senegal', 'guinea', 'mali', 'gambia', 'west-africa'] },
  { lon:  -5, label: 'GULF COAST',    tags: ['ivory-coast', 'ghana', 'liberia', 'sierra-leone', 'west-africa'] },
  { lon:   5, label: 'NAIJA DELTA',   tags: ['nigeria', 'naija', 'benin', 'togo', 'west-africa'] },
  { lon:  11, label: 'CAMEROON',      tags: ['cameroon', 'central-africa'] },
  { lon:  18, label: 'CONGO BASIN',   tags: ['congo', 'drc', 'central-africa', 'angola', 'lusophone-africa'] },
  { lon:  28, label: 'MZANSI',        tags: ['south-africa', 'mzansi', 'southern-africa', 'zimbabwe'] },
  { lon:  36, label: 'EAST AFRICA',   tags: ['east-africa', 'kenya', 'tanzania', 'ethiopia', 'uganda'] },
  { lon:   3, label: 'NORTH AFRICA',  tags: ['north-africa', 'algeria', 'morocco', 'tunisia'] },
];

// Exported so VoyoEarth can show the compass label without re-implementing the lookup.
export function getNearestClusterLabel(lon: number): string {
  let nearest = GEO_CLUSTERS[0];
  let minDist = Infinity;
  for (const c of GEO_CLUSTERS) {
    // Wrapped angular distance on [-180, 180]
    const dist = Math.abs(((lon - c.lon + 540) % 360) - 180);
    if (dist < minDist) { minDist = dist; nearest = c; }
  }
  return nearest.label;
}

const DEFAULT_LON = 5;    // Nigeria / Gulf of Guinea — richest catalog
const DEFAULT_DEPTH = 0.4; // moderate geo specificity on first load
const LON_STEP = 15;       // degrees per left/right swipe
const DEPTH_STEP = 0.25;
const PAGE = 40; // fetch more than needed — rankMoments trims to taste

function wrapLon(lon: number): number {
  return ((lon + 180 + 360) % 360) - 180;
}

// Given longitude and depth, derive which cultural_tags to filter.
// depth 0→<0.2: no geo filter (ForYou); depth 1.0: radius=5° (very specific).
function getTagsForPosition(lon: number, depth: number): string[] {
  if (depth < 0.2) return [];
  const radius = 50 - depth * 45; // 0.2→41°  0.6→23°  1.0→5°
  const tags: string[] = [];
  for (const c of GEO_CLUSTERS) {
    const dist = Math.abs(((lon - c.lon + 540) % 360) - 180);
    if (dist <= radius) tags.push(...c.tags);
  }
  return [...new Set(tags)];
}

async function queryMoments(lon: number, depth: number, seen: Set<string>): Promise<Moment[]> {
  if (!supabase || !isSupabaseConfigured) return [];

  const tags = getTagsForPosition(lon, depth);

  let q = supabase.from('voyo_moments').select('*').eq('is_active', true).limit(PAGE);

  if (tags.length > 0) {
    q = q.overlaps('cultural_tags', tags).order('virality_score', { ascending: false });
  } else {
    // ForYou — no geo filter; taste ranking does all the work
    q = q.order('heat_score', { ascending: false });
  }

  const { data } = await q;
  const raw = ((data || []) as Moment[]).filter(m => !seen.has(m.id));

  const insights = getInsights();
  return rankMoments(raw, {
    favoriteArtists: new Set(insights.favoriteArtists.map(a => a.toLowerCase())),
    favoriteMoods: new Set(insights.favoriteMoods.map(m => m.toLowerCase())),
    take: raw.length,
    maxPerCreator: 3,
  });
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useEarth() {
  const [current, setCurrent] = useState<Moment | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [lastDir, setLastDir] = useState<EarthDir | null>(null);
  const [loading, setLoading] = useState(true);
  const [geoLon, setGeoLon] = useState(DEFAULT_LON);
  const [compassDepth, setCompassDepth] = useState(DEFAULT_DEPTH);

  // Refs mirror the state values for synchronous reads inside navigate().
  // React state updates are async; we need the updated values immediately.
  const lonRef = useRef(DEFAULT_LON);
  const depthRef = useRef(DEFAULT_DEPTH);
  const transitRef = useRef(false);

  const seen = useRef(new Set<string>());
  const trail = useRef<Moment[]>([]);
  const pool = useRef<Moment[]>([]);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refill = useCallback(async (lon: number, depth: number) => {
    const results = await queryMoments(lon, depth, seen.current);
    pool.current = results;
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      await refill(lonRef.current, depthRef.current);
      const first = pool.current[0] ?? null;
      if (first) {
        seen.current.add(first.id);
        markShown(first.id, first.creator_username || first.creator_name);
        trail.current = [first];
        setCurrent(first);
      }
    } finally {
      setLoading(false);
    }
  }, [refill]);

  const navigate = useCallback(async (dir: EarthDir) => {
    if (transitRef.current) return;

    let newLon = lonRef.current;
    let newDepth = depthRef.current;

    switch (dir) {
      case 'left':  newLon = wrapLon(lonRef.current - LON_STEP); break;
      case 'right': newLon = wrapLon(lonRef.current + LON_STEP); break;
      case 'up':    newDepth = Math.min(1.0, depthRef.current + DEPTH_STEP); break;
      case 'down':  newDepth = Math.max(0.0, depthRef.current - DEPTH_STEP); break;
    }

    const moved = newLon !== lonRef.current || newDepth !== depthRef.current;
    lonRef.current = newLon;
    depthRef.current = newDepth;

    // Reuse pool only when position hasn't changed (same geo + depth)
    let pick: Moment | null = null;
    if (!moved) {
      const fresh = pool.current.filter(m => !seen.current.has(m.id));
      pick = fresh[0] ?? null;
    }
    if (!pick) {
      const fetched = await queryMoments(newLon, newDepth, seen.current);
      pool.current = fetched;
      pick = fetched[0] ?? null;
    }
    if (!pick) return;

    transitRef.current = true;
    setTransitioning(true);
    setLastDir(dir);
    if (moved) {
      setGeoLon(newLon);
      setCompassDepth(newDepth);
    }

    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    transitionTimer.current = setTimeout(() => {
      seen.current.add(pick!.id);
      markShown(pick!.id, pick!.creator_username || pick!.creator_name);
      trail.current.push(pick!);
      if (trail.current.length > 50) trail.current.shift();
      setCurrent(pick!);
      transitRef.current = false;
      setTransitioning(false);
    }, 320);

    // Background prefetch for the next swipe
    setTimeout(() => void refill(newLon, newDepth), 400);
  }, [refill]);

  // Called when the audio player starts a new track — repositions the
  // compass to the geographic origin of that track's genre.
  const seedFromGenre = useCallback(async (genre: string) => {
    const key = genre.toLowerCase();
    const lon = GENRE_GEO_MAP[key] ?? DEFAULT_LON;
    const depth = 0.6; // mid-depth: specific enough to feel geographic, not a dead-end
    lonRef.current = lon;
    depthRef.current = depth;
    setGeoLon(lon);
    setCompassDepth(depth);
    setLoading(true);
    try {
      await refill(lon, depth);
      const first = pool.current[0] ?? null;
      if (first && first.id !== current?.id) {
        seen.current.add(first.id);
        markShown(first.id, first.creator_username || first.creator_name);
        trail.current.push(first);
        setCurrent(first);
      }
    } finally {
      setLoading(false);
    }
  }, [current, refill]);

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

    // OYE'd moments are exempt from cooldown (loved content can resurface)
    clearCooldownForMoment(momentId);

    // Atomic increment (migration 029). Falls back to read-then-write if
    // the RPC hasn't been applied to this project yet.
    try {
      const { error } = await supabase.rpc('record_moment_reaction', { p_moment_id: momentId });
      if (!error) return;
    } catch { /* migration not applied yet — fall through */ }

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
    geoLon,
    compassDepth,
    loadInitial,
    navigate,
    seedFromGenre,
    recordPlay,
    recordOye,
  };
}
