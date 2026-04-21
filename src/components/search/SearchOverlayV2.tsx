/**
 * VOYO Music - Search Overlay V2
 * Clean, fast search with Queue + Discovery actions
 */

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { Search, X, Music2, Clock, Play, Compass, Disc3, Radio, User } from 'lucide-react';
import { OyeButton } from '../oye/OyeButton';
import { VoyoIcon, VoyoIconName } from '../ui/VoyoIcon';
import { VinylLoader } from '../ui/VinylLoader';
import { usePlayerStore } from '../../store/playerStore';
import { app } from '../../services/oyo';
import { Track } from '../../types';
import { searchMusic, SearchResult, prefetchTrack } from '../../services/api';
import { getThumb } from '../../utils/thumbnail';
import { SmartImage } from '../ui/SmartImage';
import { searchCache } from '../../utils/searchCache';
import { addSearchResultsToPool } from '../../services/personalization';
import { syncSearchResults } from '../../services/databaseSync';
import { AlbumSection } from './AlbumSection';
import { VibesSection } from './VibesSection';
import { devWarn } from '../../utils/logger';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { getVibeEssence } from '../../services/essenceEngine';
import { voyoStream } from '../../services/voyoStream';
import { onSignal as oyaPlanSignal } from '../../services/oyoPlan';

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onArtistTap?: (artistName: string) => void;
  /**
   * Optional — fires after handleSelectTrack has kicked off the pipeline
   * (app.playTrack + R2 gate). Parent opens a float-over-everything
   * VideoMode so the user sees the iframe video immediately, even before
   * R2 caching completes. The search overlay stays mounted underneath.
   */
  onEnterVideoMode?: () => void;
}

const SEARCH_HISTORY_KEY = 'voyo_search_history';
const MAX_HISTORY = 10;

// Track item - clean, no drag, just tap to play + action buttons
interface TrackItemProps {
  result: SearchResult;
  // Pre-resolved Track for the OyeButton state machine + commit action.
  // Parent computes via resultToTrack so we don't duplicate here.
  track: Track;
  index: number;
  isActive: boolean;
  isCached: boolean;
  onSelect: (result: SearchResult) => void;
  // Fires on Oye tap. Parent adds the track to the personalization pool
  // + syncs collective brain before the oyeCommit fires.
  onOye: (track: Track) => void;
  onAddToDiscovery: (result: SearchResult) => void;
  formatDuration: (seconds: number) => string;
  formatViews: (views: number) => string;
}

const TrackItem = memo(({
  result,
  track,
  index,
  isActive,
  isCached,
  onSelect,
  onOye,
  onAddToDiscovery,
  formatDuration,
  formatViews,
}: TrackItemProps) => {
  const handleDiscoveryClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToDiscovery(result);
  };

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer group active:bg-white/[0.06] border transition-colors ${
        isActive
          ? 'border-purple-400/50 bg-purple-500/10'
          : 'border-transparent hover:border-[#28282f]'
      }`}
      style={{ background: isActive ? 'rgba(139,92,246,0.12)' : 'rgba(28, 28, 35, 0.4)' }}
      onClick={() => onSelect(result)}
    >
      {/* Thumbnail */}
      <div className="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-white/5">
        <SmartImage
          src={result.thumbnail}
          alt={result.title}
          className="w-full h-full object-cover"
          trackId={result.voyoId}
          artist={result.artist}
          title={result.title}
          lazy={true}
        />
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <Play className="w-5 h-5 text-white" fill="white" />
        </div>
      </div>

      {/* Track Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <h4 className="text-white/90 font-medium truncate text-sm">{result.title}</h4>
          {/* R2-cached marker — track plays instantly + survives BG lockscreen.
              Bronze-gold dot, tooltip explains. Letterspaced so it doesn't crowd. */}
          {isCached && (
            <span
              className="flex-shrink-0 text-[9px] font-bold tracking-[0.12em] uppercase px-1.5 py-[1px] rounded-md"
              style={{
                color: 'rgba(232,208,158,0.95)',
                background: 'rgba(212,175,110,0.14)',
                border: '1px solid rgba(212,175,110,0.30)',
                boxShadow: '0 0 8px -2px rgba(212,175,110,0.35)',
              }}
              title="In Disco — plays instantly, survives lockscreen"
            >
              ✦ DISCO
            </span>
          )}
        </div>
        <p className="text-white/40 text-xs truncate">{result.artist}</p>
        <div className="flex items-center gap-2 text-[10px] text-white/25 mt-0.5">
          <span>{formatDuration(result.duration)}</span>
          {result.views > 0 && (
            <>
              <span>·</span>
              <span>{formatViews(result.views)}</span>
            </>
          )}
        </div>
      </div>

      {/* Action Buttons — tighter (32×32), more space, calmer chroma.
          Row had two chunky 44×44 tap targets crowding the right edge;
          now 32×32 with 10px gap. Icons a touch smaller, subtler bg,
          still accessible at touch sizes because the whole row is the
          primary tap surface (plays the track). */}
      <div className="flex items-center gap-2.5 ml-1">
        <OyeButton track={track} size="sm" onClick={onOye} />
        <button
          className="w-8 h-8 rounded-full bg-[#D4A053]/12 border border-[#D4A053]/20 active:scale-90 transition-transform flex items-center justify-center"
          onClick={handleDiscoveryClick}
          aria-label="Discover similar tracks"
          title="Discover More Like This"
        >
          <Compass className="w-3.5 h-3.5 text-[#D4A053]" />
        </button>
      </div>
    </div>
  );
});

// Artist master data for search
import artistMasterJSON from '../../data/artist_master.json';
const ARTIST_LIST = Object.values((artistMasterJSON as any).artists || artistMasterJSON) as Array<{
  canonical_name: string; normalized_name: string; tier: string;
  country: string; region: string; primary_genre: string;
}>;

// Country flag mapping
const COUNTRY_FLAGS: Record<string, string> = {
  NG: '\u{1F1F3}\u{1F1EC}', GH: '\u{1F1EC}\u{1F1ED}', KE: '\u{1F1F0}\u{1F1EA}',
  ZA: '\u{1F1FF}\u{1F1E6}', SN: '\u{1F1F8}\u{1F1F3}', DZ: '\u{1F1E9}\u{1F1FF}',
  GN: '\u{1F1EC}\u{1F1F3}', CI: '\u{1F1E8}\u{1F1EE}', CD: '\u{1F1E8}\u{1F1E9}',
  CM: '\u{1F1E8}\u{1F1F2}', TZ: '\u{1F1F9}\u{1F1FF}', GB: '\u{1F1EC}\u{1F1E7}',
  US: '\u{1F1FA}\u{1F1F8}', FR: '\u{1F1EB}\u{1F1F7}', JM: '\u{1F1EF}\u{1F1F2}',
};

export const SearchOverlayV2 = ({ isOpen, onClose, onArtistTap, onEnterVideoMode }: SearchOverlayProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'tracks' | 'albums' | 'artists' | 'vibes'>('tracks');
  // Keyboard navigation — index into `results` (−1 = nothing selected)
  const [activeIndex, setActiveIndex] = useState(-1);

  // Toast feedback for queue/discovery actions
  const [toast, setToast] = useState<{ text: string; type: 'queue' | 'discovery' } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchIdRef = useRef(0); // Monotonic counter to ignore stale results
  const updateDiscoveryForTrack = usePlayerStore(s => s.updateDiscoveryForTrack);

  // Scroll-driven UX: section header fades 15-25%, search bar slides to
  // bottom (thumb-zone) at 45%+. Lets users keep refining without scrolling
  // back up — common pattern in music apps.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollPct, setScrollPct] = useState(0);
  // rAF-throttle + quantize scroll state: without this, onScroll fires
  // at ~60fps and every tick triggered a full SearchOverlayV2 re-render
  // (TrackItem is memoized but the parent cascade still janked). Now we
  // at most one state update per frame, and only when the rounded value
  // actually changed (2% bins) — drops scroll-time renders by ~20x.
  const scrollRafRef = useRef<number | null>(null);
  const scrollPctRef = useRef(0);
  const handleResultsScroll = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollContainerRef.current;
      if (!el) return;
      const max = Math.max(1, el.scrollHeight - el.clientHeight);
      const raw = Math.min(1, Math.max(0, el.scrollTop / max));
      // Round to 2% bins to avoid state updates on sub-pixel jitter.
      const binned = Math.round(raw * 50) / 50;
      if (Math.abs(binned - scrollPctRef.current) < 0.0001) return;
      scrollPctRef.current = binned;
      setScrollPct(binned);
    });
  }, []);
  useEffect(() => () => {
    if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
  }, []);
  const sectionHeaderOpacity = Math.max(0, 1 - Math.max(0, (scrollPct - 0.15)) / 0.10);
  const searchAtBottom = scrollPct >= 0.45;

  // R2 cache awareness — for each result, async batch-check the edge
  // worker /exists/ endpoint. Tracks already in R2 get a "✦ DISCO" badge
  // so the user spots which will play instantly + survive the lockscreen.
  const [cachedSet, setCachedSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (results.length === 0) { setCachedSet(new Set()); return; }
    let cancelled = false;
    const ids = results.map(r => r.voyoId).filter(id => /^[A-Za-z0-9_-]{11}$/.test(id));
    // Concurrent /exists/ checks, capped at 25 in-flight
    const checkOne = async (id: string): Promise<[string, boolean]> => {
      try {
        const res = await fetch(`https://voyo-edge.dash-webtv.workers.dev/exists/${id}`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) return [id, false];
        const data = await res.json();
        return [id, !!(data?.exists && (data?.high || data?.low))];
      } catch { return [id, false]; }
    };
    Promise.all(ids.map(checkOne)).then(pairs => {
      if (cancelled) return;
      const next = new Set<string>();
      for (const [id, ok] of pairs) if (ok) next.add(id);
      setCachedSet(next);
    });
    return () => { cancelled = true; };
  }, [results]);

  // Pre-warm top 3 results as soon as they appear — fire-and-forget.
  // By the time the user taps (typically 2-5s later), the VPS has already
  // started extracting. Uses the existing edge-worker prefetch endpoint.
  useEffect(() => {
    if (results.length === 0) return;
    results.slice(0, 3).forEach(r => { prefetchTrack(r.voyoId); });
  }, [results]);

  // Load search history
  useEffect(() => {
    try {
      const history = localStorage.getItem(SEARCH_HISTORY_KEY);
      if (history) setSearchHistory(JSON.parse(history));
    } catch { /* corrupted — start fresh */ }
  }, []);

  // Save to history
  const saveToHistory = (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    setSearchHistory((prev) => {
      const filtered = prev.filter((q) => q !== searchQuery);
      const updated = [searchQuery, ...filtered].slice(0, MAX_HISTORY);
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  // Focus input when opened, clean state when closed
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
    if (!isOpen) {
      setResults([]);
      setQuery('');
      setError(null);
      setIsSearching(false);
      setActiveIndex(-1);
      searchIdRef.current++; // cancel any in-flight search
      if (debounceRef.current) clearTimeout(debounceRef.current);
    }
  }, [isOpen]);

  // Reset keyboard-nav index when results change — don't leave a ghost
  // selection pointing at an old result that no longer exists.
  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

  // Global Escape handler while the overlay is open. Closes the search.
  // Separate from the ×-button so users know the keyboard escape hatch works.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Progressive search: DB results appear fast, YouTube merges in after
  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    const thisSearchId = ++searchIdRef.current;

    setIsSearching(true);
    setError(null);

    // CHECK CACHE FIRST — instant
    const cachedResults = searchCache.get(searchQuery);
    if (cachedResults) {
      if (searchIdRef.current === thisSearchId) {
        setResults(cachedResults);
        setIsSearching(false);
      }
      return;
    }

    // Deduplicate helper
    const seen = new Set<string>();
    const dedup = (items: SearchResult[]) => {
      const unique: SearchResult[] = [];
      for (const r of items) {
        if (!seen.has(r.voyoId)) {
          seen.add(r.voyoId);
          unique.push(r);
        }
      }
      return unique;
    };

    // SECTIONED LAYOUT — Dash's call (2026-04-14):
    //   "i wanna add below normal library search the youtube/player search
    //    results and have the ui clearly reflect"
    // Library (DB/pool) sits on top; YouTube fresh results below with a
    // labeled divider. No more spaghetti — clean mental model: "what we
    // already have" then "what's out there".

    // PARALLEL fetch — DB returns in ~200ms, YT in 1-4s
    const essence = getVibeEssence();
    const dbPromise = isSupabaseConfigured
      ? supabase!.rpc('search_tracks_by_vibe', {
          p_query: searchQuery,
          p_afro_heat: essence.afro_heat,
          p_chill: essence.chill,
          p_party: essence.party,
          p_workout: essence.workout,
          p_late_night: essence.late_night,
          p_limit: 25,
        }).then(
          ({ data }) => (data || []).map((t: any) => ({
            voyoId: t.youtube_id,
            title: t.title,
            artist: t.artist || 'Unknown Artist',
            thumbnail: t.thumbnail_url || `https://i.ytimg.com/vi/${t.youtube_id}/hqdefault.jpg`,
            views: Math.round((t.vibe_match_score || 0) * 100),
            source: 'library' as const,
          } as SearchResult)),
          (err: unknown) => { devWarn('[Search] DB error:', err); return []; }
        )
      : Promise.resolve([] as SearchResult[]);

    const ytPromise = searchMusic(searchQuery, 25).catch((err: unknown) => {
      devWarn('[Search] YT error:', err);
      return [] as SearchResult[];
    });

    // PHASE 1: render library first as soon as it arrives — fast feedback
    dbPromise.then((data) => {
      if (searchIdRef.current !== thisSearchId) return;
      const tagged = dedup(data).map(r => ({ ...r, source: 'library' as const }));
      if (tagged.length > 0) {
        setResults(tagged);
        setIsSearching(false);
        saveToHistory(searchQuery);
      }
    });

    // PHASE 2: append YouTube section once it arrives. Both sections live in
    // the same flat array; render code splits by `source` field for sectioning.
    const [db, yt] = await Promise.all([dbPromise, ytPromise]);
    if (searchIdRef.current !== thisSearchId) return;

    const librarySeen = new Set<string>();
    const library = dedup(db).map(r => { librarySeen.add(r.voyoId); return { ...r, source: 'library' as const }; });
    // Drop YouTube duplicates that already appear in library — no point showing the same track twice
    const youtube = dedup(yt).filter(r => !librarySeen.has(r.voyoId)).map(r => ({ ...r, source: 'youtube' as const }));

    if (library.length > 0 || youtube.length > 0) {
      setResults([...library, ...youtube]);
      saveToHistory(searchQuery);
    }

    if (searchIdRef.current !== thisSearchId) return;

    // Final: cache merged results, sync, clear loading
    setIsSearching(false);
    setResults(prev => {
      if (prev.length > 0) {
        searchCache.set(searchQuery, prev);
        syncSearchResults(prev);
      } else {
        setError('No results found. Try a different search.');
      }
      return prev;
    });
  }, []);

  const handleSearch = (value: string) => {
    setQuery(value);

    // Don't clear results while typing — keep showing previous results
    // Only clear if input is empty
    if (!value.trim()) {
      setResults([]);
      setIsSearching(false);
      searchIdRef.current++; // cancel any in-flight
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Short queries: longer debounce (user still typing)
    // Longer queries: shorter debounce (more intentional)
    const delay = value.trim().length <= 3 ? 200 : 120;
    debounceRef.current = setTimeout(() => performSearch(value), delay);
  };

  // Convert search result to track
  const resultToTrack = useCallback((result: SearchResult): Track => ({
    id: result.voyoId,
    title: result.title,
    artist: result.artist,
    album: 'VOYO',
    trackId: result.voyoId,
    coverUrl: result.thumbnail,
    tags: ['search'],
    mood: 'afro',
    region: 'NG',
    oyeScore: result.views || 0,
    duration: 0,
    createdAt: new Date().toISOString(),
  }), []);

  const showToast = useCallback((text: string, type: 'queue' | 'discovery') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 1500);
  }, []);

  const handleSelectTrack = useCallback((result: SearchResult) => {
    const track = resultToTrack(result);
    addSearchResultsToPool([track]);
    // Central orchestrator: plays, signals, telemetry, prefetch — all routed.
    app.playTrack(track, 'search');
    oyaPlanSignal('search_play', track.artist ?? '');
    // Float VideoMode over search so the user sees the iframe immediately
    // (buys time while R2 catches up). Parent keeps search mounted underneath.
    onEnterVideoMode?.();
  }, [resultToTrack, onEnterVideoMode]);


  // Called from OyeButton's onClick override. Pool sync + collective brain
  // sync happen here (search-specific concerns); the actual Oye action
  // still flows through app.oyeCommit for single-source truth on the
  // boost/queue/signal fanout.
  const handleOyeCommit = useCallback((track: Track) => {
    addSearchResultsToPool([track]);
    app.oyeCommit(track);
    showToast('Oye — warming up', 'queue');
  }, [showToast]);

  const handleAddToDiscovery = useCallback((result: SearchResult) => {
    const track = resultToTrack(result);
    addSearchResultsToPool([track]);
    updateDiscoveryForTrack(track);
    showToast('Finding similar', 'discovery');
  }, [resultToTrack, updateDiscoveryForTrack, showToast]);

  const formatDuration = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const formatViews = useCallback((views: number): string => {
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
    if (views >= 1000) return `${(views / 1000).toFixed(0)}K`;
    return views.toString();
  }, []);

  return (
    <>
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/80"
            onClick={onClose}
            style={{
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              }}
          />

          {/* Main Container - Full width, no portal zones */}
          <div
            className="fixed inset-x-0 top-0 bottom-0 z-50 flex flex-col px-4 pb-0"
            style={{ paddingTop: 'max(16px, env(safe-area-inset-top, 16px))' }}
          >
            {/* Search Header — slides to bottom (thumb zone) past 45% scroll.
                Position is absolute so the slide doesn't reflow the results.
                We compensate the results container with conditional padding. */}
            <div
              className="mb-3"
              style={{
                position: 'absolute',
                left: 16, right: 16,
                // Anchor stays at the TOP always; transform slides the whole
                // header down when searchAtBottom flips. Previously we
                // swapped top↔bottom between 'auto' and a value, which
                // browsers can't smoothly interpolate → the "glittery"
                // jump Dash felt. transform: translateY is GPU-accelerated
                // and animates cleanly between two concrete values.
                top: 'max(16px, env(safe-area-inset-top, 16px))',
                zIndex: 51,
                transform: searchAtBottom
                  ? 'translateY(calc(100dvh - 100% - max(16px, env(safe-area-inset-top, 16px)) - max(16px, env(safe-area-inset-bottom, 16px))))'
                  : 'translateY(0)',
                transition: 'transform 260ms cubic-bezier(0.4, 0, 0.2, 1), background-color 220ms ease, padding 220ms ease',
                willChange: 'transform',
                background: searchAtBottom
                  ? 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 30%, rgba(0,0,0,0.85) 100%)'
                  : 'transparent',
                paddingTop: searchAtBottom ? 24 : 0,
                paddingBottom: searchAtBottom ? 4 : 0,
                marginLeft: searchAtBottom ? -16 : 0,
                marginRight: searchAtBottom ? -16 : 0,
                paddingLeft: searchAtBottom ? 16 : 0,
                paddingRight: searchAtBottom ? 16 : 0,
              }}
            >
              <div className="flex items-center gap-2">
                {/* Search Input — more present visually (stronger border +
                    frosted depth) but lower-profile in height (py-2.5 →
                    compact), and the transition on background/border is
                    spelled out as `all 260ms ease` so the header slide
                    between top ↔ bottom docks doesn't flicker. */}
                <div
                  className="flex-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl focus-within:ring-1 focus-within:ring-[#8b5cf6]/40"
                  style={{
                    background: 'rgba(22, 22, 28, 0.72)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    backdropFilter: 'blur(14px) saturate(140%)',
                    WebkitBackdropFilter: 'blur(14px) saturate(140%)',
                    boxShadow: '0 6px 18px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04)',
                    transition: 'background 260ms ease, border-color 260ms ease, box-shadow 260ms ease',
                  }}
                >
                  <Search className="w-[18px] h-[18px] text-white/45 flex-shrink-0" strokeWidth={2} />
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="Search songs, artists..."
                    value={query}
                    onChange={(e) => handleSearch(e.target.value)}
                    // Keyboard navigation: ↓/↑ move through results,
                    // Enter plays the active one (or the first if none
                    // active). Only active on the 'tracks' tab.
                    onKeyDown={(e) => {
                      if (activeTab !== 'tracks' || results.length === 0) return;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setActiveIndex((i) => (i + 1) % results.length);
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        const target = activeIndex >= 0 ? results[activeIndex] : results[0];
                        if (target) handleSelectTrack(target);
                      }
                    }}
                    className="flex-1 bg-transparent text-white placeholder:text-white/30 focus:outline-none text-[15px]"
                  />
                  {isSearching && <VinylLoader size={14} opacity={0.35} colorClass="text-white/70" className="flex-shrink-0" />}
                  {query && !isSearching && (
                    <button onClick={() => { setQuery(''); setResults([]); }} className="text-white/35 p-1 active:scale-90 transition-transform" aria-label="Clear search">
                      <X className="w-[14px] h-[14px]" strokeWidth={2.2} />
                    </button>
                  )}
                </div>
                {/* Close X — dialed down to match the in-input clear X
                    (no bg pill, no 44×44 tap target chrome). Still meets
                    touch size via w-10. Fades opacity instead of shouting. */}
                <button
                  className="w-10 h-10 rounded-full active:scale-90 transition-all flex items-center justify-center text-white/40 hover:text-white/70"
                  onClick={onClose}
                  aria-label="Close search"
                  style={{ opacity: query ? 0.5 : 0.85 }}
                >
                  <X className="w-[18px] h-[18px]" strokeWidth={2} />
                </button>
              </div>

              {/* Tabs — Tracks is label-only (it's the default surface,
                  no need for a glyph). Other tabs keep the VOYO 3D icon
                  as a visual anchor. Active tab: soft bronze glow ring. */}
              <div className="flex gap-1 mt-3">
                {([
                  { key: 'tracks' as const, voyo: null, label: 'Tracks' },
                  { key: 'artists' as const, voyo: 'orb-artist' as VoyoIconName, label: 'Artists' },
                  { key: 'albums' as const, voyo: 'vinyl-disc' as VoyoIconName, label: 'Albums' },
                  { key: 'vibes' as const, voyo: 'radio-vibes' as VoyoIconName, label: 'Vibes' },
                ]).map(({ key, voyo, label }) => (
                  <button
                    key={key}
                    className="flex-1 py-2 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-1.5"
                    style={{
                      background: activeTab === key ? 'rgba(212, 175, 110, 0.10)' : 'transparent',
                      color: activeTab === key ? 'rgba(232, 208, 158, 0.95)' : 'rgba(255,255,255,0.38)',
                      border: activeTab === key ? '1px solid rgba(212, 175, 110, 0.20)' : '1px solid transparent',
                      boxShadow: activeTab === key ? '0 0 16px -8px rgba(212,175,110,0.35)' : 'none',
                    }}
                    onClick={() => setActiveTab(key)}
                  >
                    {voyo && <VoyoIcon name={voyo} size={18} glow={activeTab === key} style={{ opacity: activeTab === key ? 1 : 0.55 }} />}
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Results - Full width scrollable area.
                Top padding reserves space for the absolutely-positioned search
                header (when at top). Bottom padding swells when the header has
                slid down so results don't hide behind it. */}
            <div
              ref={scrollContainerRef}
              onScroll={handleResultsScroll}
              className="flex-1 overflow-y-auto space-y-0.5 overscroll-contain"
              style={{
                paddingTop: searchAtBottom ? 8 : 132,
                paddingBottom: searchAtBottom
                  ? 'calc(140px + max(16px, env(safe-area-inset-bottom, 16px)))'
                  : 'max(16px, env(safe-area-inset-bottom, 16px))',
                transition: 'padding-top 320ms ease, padding-bottom 320ms ease',
              }}>
              {/* Artist Section */}
              {activeTab === 'artists' && (
                <div className="space-y-1 px-1">
                  {query.trim().length >= 2 ? (
                    ARTIST_LIST
                      .filter(a => a.canonical_name.toLowerCase().includes(query.toLowerCase()) || a.normalized_name.includes(query.toLowerCase()))
                      .slice(0, 20)
                      .map((artist) => (
                        <div
                          key={artist.normalized_name}
                          className="flex items-center gap-3 p-3 rounded-xl cursor-pointer active:bg-white/[0.06] border border-transparent hover:border-[#28282f]"
                          style={{ background: 'rgba(28, 28, 35, 0.4)' }}
                          onClick={() => {
                            if (onArtistTap) {
                              onArtistTap(artist.canonical_name);
                              onClose();
                            }
                            }}
                        >
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white/80 text-sm font-bold"
                            style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.3), rgba(139,92,246,0.1))' }}>
                            {artist.canonical_name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-white/90 font-medium truncate text-sm">{artist.canonical_name}</h4>
                            <p className="text-white/40 text-xs truncate">
                              {COUNTRY_FLAGS[artist.country] || ''} {artist.primary_genre} · Tier {artist.tier}
                            </p>
                          </div>
                          <User className="w-4 h-4 text-white/20" />
                        </div>
                      ))
                  ) : (
                    <div className="text-center py-8">
                      <User className="w-8 h-8 text-white/20 mx-auto mb-2" />
                      <p className="text-white/30 text-sm">Search for an artist</p>
                      <p className="text-white/15 text-xs mt-1">{ARTIST_LIST.length} artists in library</p>
                    </div>
                  )}
                </div>
              )}

              {/* Album Section */}
              {activeTab === 'albums' && (
                <AlbumSection query={query} isVisible={true} />
              )}

              {/* Vibes Section */}
              {activeTab === 'vibes' && (
                <VibesSection query={query} isVisible={true} />
              )}

              {/* Track Results */}
              {activeTab === 'tracks' && (
                <>
                  {/* Search History */}
                  {!query && searchHistory.length > 0 && !isSearching && (
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2 px-1">
                        <p className="text-white/40 text-xs">Recent</p>
                        {/* Clear all — small, quiet, doesn't demand attention
                            but discoverable for users who want to reset. */}
                        <button
                          onClick={() => {
                            setSearchHistory([]);
                            localStorage.removeItem(SEARCH_HISTORY_KEY);
                          }}
                          className="text-white/30 hover:text-white/60 active:text-white/80 text-[10px] uppercase tracking-wider px-2 py-1 transition-colors"
                          aria-label="Clear search history"
                        >
                          Clear
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {searchHistory.map((historyQuery, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-white/55 bg-white/5 border border-white/8 active:bg-white/10 transition-colors"
                          >
                            <button
                              onClick={() => { setQuery(historyQuery); performSearch(historyQuery); }}
                              className="flex items-center gap-1.5"
                            >
                              <Clock className="w-3 h-3" />
                              <span className="text-xs">{historyQuery}</span>
                            </button>
                            {/* Dedicated delete button — always visible so
                                touch users can actually tap it. Previous
                                opacity-0 group-hover approach was desktop-
                                only. Stop propagation keeps the parent
                                query-run from firing on delete. */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSearchHistory(prev => {
                                  const updated = prev.filter(q => q !== historyQuery);
                                  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
                                  return updated;
                                });
                              }}
                              className="ml-0.5 w-4 h-4 rounded-full flex items-center justify-center text-white/35 hover:text-white/70 hover:bg-white/10 active:bg-white/20 transition-colors"
                              aria-label={`Remove ${historyQuery} from history`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {!query && !isSearching && results.length === 0 && searchHistory.length === 0 && (
                    <div className="text-center py-20">
                      <Search className="w-10 h-10 mx-auto mb-3 text-white/15" />
                      <p className="text-white/25 text-sm">Search for any song or artist</p>
                    </div>
                  )}

                  {/* Error */}
                  {error && (
                    <div className="text-center py-12">
                      <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
                        <Search className="w-7 h-7 text-red-400/40" />
                      </div>
                      <p className="text-red-400/80 text-sm">{error}</p>
                    </div>
                  )}

                  {/* No results — minimal, faded, no icon chrome */}
                  {!isSearching && query.length >= 2 && results.length === 0 && !error && (
                    <div className="text-center py-8">
                      <p className="text-white/30 text-[11px] font-medium tracking-wide">No results for &ldquo;{query}&rdquo;</p>
                      <p className="text-white/15 text-[10px] mt-1">try different keywords</p>
                    </div>
                  )}

                  {/* Sectioned results — Library on top, YouTube below */}
                  {(() => {
                    const library = results.filter(r => r.source === 'library');
                    const youtube = results.filter(r => r.source === 'youtube');
                    let runningIndex = -1;
                    const renderItem = (result: SearchResult) => {
                      runningIndex += 1;
                      const idx = runningIndex;
                      return (
                        <TrackItem
                          key={result.voyoId}
                          result={result}
                          track={resultToTrack(result)}
                          index={idx}
                          isActive={idx === activeIndex}
                          isCached={cachedSet.has(result.voyoId)}
                          onSelect={handleSelectTrack}
                          onOye={handleOyeCommit}
                          onAddToDiscovery={handleAddToDiscovery}
                          formatDuration={formatDuration}
                          formatViews={formatViews}
                        />
                      );
                    };
                    return (
                      <>
                        {library.length > 0 && (
                          <>
                            {/* "Disco" — Dash's call (2026-04-14): "your disco" — your dance floor,
                                your collection. Diaspora music-soul language. Faded bronze-gold,
                                like an old jazz pressing label. Fades on scroll past 15% so the
                                user sees results, not chrome. */}
                            <div className="flex items-center gap-2 px-1 pt-1 pb-2 text-[10.5px] font-semibold tracking-[0.18em] uppercase"
                                 style={{ color: 'rgba(212, 175, 110, 0.85)', opacity: sectionHeaderOpacity, transition: 'opacity 200ms ease' }}>
                              <span style={{ textShadow: '0 0 12px rgba(212,175,110,0.18)' }}>My Disco</span>
                              <span className="flex-1 h-px"
                                    style={{ background: 'linear-gradient(to right, rgba(212,175,110,0.35), rgba(212,175,110,0.04))' }} />
                            </div>
                            <div style={{ borderRadius: 14, padding: '2px 0',
                                          background: 'linear-gradient(180deg, rgba(212,175,110,0.045) 0%, rgba(212,175,110,0.0) 70%)' }}>
                              {library.map(renderItem)}
                            </div>
                          </>
                        )}
                        {youtube.length > 0 && (
                          <>
                            <div className={`flex items-center gap-2 px-1 ${library.length > 0 ? 'pt-6' : 'pt-1'} pb-2 text-[10.5px] font-semibold tracking-[0.18em] uppercase text-white/45`}
                                 style={{ opacity: sectionHeaderOpacity, transition: 'opacity 200ms ease' }}>
                              <span>From YouTube</span>
                              <span className="flex-1 h-px bg-white/10" />
                            </div>
                            {youtube.map(renderItem)}
                          </>
                        )}
                      </>
                    );
                  })()}

                  {/* Loading skeleton */}
                  {isSearching && results.length === 0 && (
                    <div className="space-y-1">
                      {[...Array(6)].map((_, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-3 p-3 rounded-xl"
                          style={{ background: 'rgba(255,255,255,0.02)', animationDelay: `${i * 80}ms` }}
                        >
                          <div className="w-12 h-12 rounded-lg bg-white/5 voyo-skeleton-shimmer flex-shrink-0" />
                          <div className="flex-1">
                            <div className="h-3 rounded bg-white/5 voyo-skeleton-shimmer mb-2" style={{ width: `${65 + (i * 5) % 25}%` }} />
                            <div className="h-2 rounded bg-white/5 voyo-skeleton-shimmer" style={{ width: `${40 + (i * 7) % 20}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Toast feedback */}
          <>
            {toast && (
              <div
                className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 px-4 py-2 rounded-full text-xs font-medium text-white/90"
                style={{
                  background: toast.type === 'queue'
                    ? 'rgba(139,92,246,0.9)'
                    : 'rgba(212,160,83,0.9)',
                  backdropFilter: 'blur(8px)',
                  }}
              >
                {toast.text}
              </div>
            )}
          </>
        </>
      )}
    </>
  );
};

export default SearchOverlayV2;
