/**
 * VOYO Music - Classic Mode: Your Library
 * Reference: Classic Mode - When clicked on profile.jpg (Middle phone)
 *
 * Features:
 * - Search within library
 * - Filter tabs: All, Liked songs, Saved songs
 * - Song list with thumbnail, title, artist, duration
 * - Tap to play, opens Classic Now Playing
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Search, Heart, Clock, Play } from 'lucide-react';
import { VoyoIcon } from '../ui/VoyoIcon';
import { usePlayerStore } from '../../store/playerStore';
import { useDownloadStore } from '../../store/downloadStore';
import { usePreferenceStore } from '../../store/preferenceStore';
import { usePlaylistStore } from '../../store/playlistStore';
import { getYouTubeThumbnail, TRACKS } from '../../data/tracks';
import { SmartImage } from '../ui/SmartImage';
import { Track } from '../../types';
import { PlaylistModal } from '../playlist/PlaylistModal';
import { OyeButton } from '../oye/OyeButton';
import { DiscoExplainer } from '../ui/DiscoExplainer';
import { searchMusic, SearchResult } from '../../services/api';

// Base filter tabs — five clean primary sets. "Disco" replaces the old
// mix of 'offline' + 'recent' since our narralogy defines Disco = any
// track that can play instantly (local cache OR known in R2).
// Playlists render as a SECONDARY chip row so they can intersect with
// the primary filter instead of crowding the same space.
const BASE_FILTERS = [
  { id: 'all',     label: 'All' },
  { id: 'liked',   label: 'Liked' },
  { id: 'disco',   label: 'Disco' },
  { id: 'bucket',  label: 'Bucket' },
  { id: 'history', label: 'History' },
];

type PlayMode = 'magic' | 'in-order' | 'shuffle';
type SortMode = 'date-desc' | 'date-asc' | 'a-z' | 'z-a';

/**
 * PlayAllButton — the bronze pill that sits on the first track row
 * (breaking the visual rhythm intentionally so the "play what's showing"
 * affordance is impossible to miss). Tap = fire the current play mode.
 * Long-press (420ms) opens the mode menu so users can switch between
 * Magic Mix / In Order / Shuffle. Matches the Vibes-section pill
 * aesthetic: rounded-full, small padding, bronze tint active, glass
 * rest state.
 */
const PlayAllButton = ({
  modeLabel,
  onPlay,
  onLongPress,
}: {
  modeLabel: string;
  onPlay: () => void;
  onLongPress: () => void;
}) => {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedLongPress = useRef(false);

  const startPress = () => {
    firedLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      firedLongPress.current = true;
      onLongPress();
    }, 420);
  };
  const endPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
      {/* Mode tag — small glass pill showing current play mode. Echoes
          the Vibes-section chip recipe so it reads as part of the
          design system, not a one-off. */}
      <span
        className="px-2 py-0.5 rounded-full text-[9px] font-bold tracking-[0.14em] uppercase pointer-events-none"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.10)',
          color: 'rgba(232,208,158,0.75)',
          backdropFilter: 'blur(6px)',
        }}
      >
        {modeLabel}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (firedLongPress.current) return; // long-press already handled
          onPlay();
        }}
        onPointerDown={(e) => { e.stopPropagation(); startPress(); }}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onPointerLeave={endPress}
        className="relative w-12 h-12 rounded-full flex items-center justify-center pointer-events-auto voyo-tap-scale voyo-hover-scale"
        style={{
          background: 'linear-gradient(135deg, #E6B865 0%, #D4A053 50%, #C4943D 100%)',
          boxShadow:
            '0 8px 22px -6px rgba(212,175,110,0.55), inset 0 1px 0 rgba(255,255,255,0.38), inset 0 -1px 0 rgba(0,0,0,0.18)',
          border: '1px solid rgba(255,255,255,0.25)',
        }}
        aria-label="Play all"
      >
        <Play className="w-[18px] h-[18px]" fill="#1b1206" style={{ color: '#1b1206' }} />
      </button>
    </div>
  );
};

/**
 * PlayModeMenu — sheet that appears on long-press of PlayAllButton.
 * Bottom sheet on mobile (matches VOYO install / Disco-explainer style)
 * with three primary pills. "In Order" expands inline to reveal sort
 * sub-options without closing the sheet.
 */
const PlayModeMenu = ({
  open,
  onClose,
  playMode,
  setPlayMode,
  sortMode,
  setSortMode,
  onPlayNow,
}: {
  open: boolean;
  onClose: () => void;
  playMode: PlayMode;
  setPlayMode: (m: PlayMode) => void;
  sortMode: SortMode;
  setSortMode: (s: SortMode) => void;
  onPlayNow: () => void;
}) => {
  const [inOrderExpanded, setInOrderExpanded] = useState(playMode === 'in-order');
  useEffect(() => { if (!open) setInOrderExpanded(playMode === 'in-order'); }, [open, playMode]);
  if (!open) return null;

  const pick = (mode: PlayMode) => {
    setPlayMode(mode);
    if (mode !== 'in-order') {
      onClose();
      onPlayNow();
    } else {
      setInOrderExpanded(true);
    }
  };

  const pickSort = (s: SortMode) => {
    setSortMode(s);
    setPlayMode('in-order');
    onClose();
    onPlayNow();
  };

  const pillStyle = (active: boolean) => ({
    background: active ? 'rgba(212,175,110,0.16)' : 'rgba(255,255,255,0.06)',
    color: active ? 'rgba(232,208,158,0.98)' : 'rgba(255,255,255,0.75)',
    border: active ? '1px solid rgba(212,175,110,0.40)' : '1px solid rgba(255,255,255,0.10)',
    boxShadow: active ? '0 0 14px -6px rgba(212,175,110,0.55)' : undefined,
  });

  return (
    <div
      className="fixed inset-0 z-[65] flex items-end justify-center"
      style={{ background: 'rgba(5,5,8,0.60)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]"
        style={{
          background: 'linear-gradient(180deg, rgba(22,16,8,0.96) 0%, rgba(12,8,4,0.97) 100%)',
          border: '1px solid rgba(212,175,110,0.24)',
          boxShadow: '0 -18px 50px -18px rgba(0,0,0,0.75)',
          animation: 'voyo-install-enter 360ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-semibold tracking-[0.22em] uppercase text-white/45">Play mode</span>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center text-white/35 text-lg voyo-tap-scale">×</button>
        </div>

        <div className="flex flex-col gap-2">
          <button onClick={() => pick('magic')} className="px-4 py-2.5 rounded-full text-left text-[13px] font-medium voyo-tap-scale" style={pillStyle(playMode === 'magic')}>
            Magic Mix
            <span className="ml-2 text-[11px] opacity-60">our system, tuned to you</span>
          </button>

          <button onClick={() => pick('in-order')} className="px-4 py-2.5 rounded-full text-left text-[13px] font-medium voyo-tap-scale flex items-center justify-between" style={pillStyle(playMode === 'in-order')}>
            <span>In Order</span>
            <span className="text-[11px] opacity-60">{inOrderExpanded ? '▾' : '▸'}</span>
          </button>

          {inOrderExpanded && (
            <div className="flex flex-wrap gap-2 pl-3 pt-1 pb-1">
              {([
                { id: 'date-desc', label: 'Newest first' },
                { id: 'date-asc',  label: 'Oldest first' },
                { id: 'a-z',       label: 'A → Z' },
                { id: 'z-a',       label: 'Z → A' },
              ] as Array<{ id: SortMode; label: string }>).map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => pickSort(id)}
                  className="px-3 py-1 rounded-full text-[11px] font-medium voyo-tap-scale"
                  style={pillStyle(playMode === 'in-order' && sortMode === id)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <button onClick={() => pick('shuffle')} className="px-4 py-2.5 rounded-full text-left text-[13px] font-medium voyo-tap-scale" style={pillStyle(playMode === 'shuffle')}>
            Shuffle
            <span className="ml-2 text-[11px] opacity-60">pure random</span>
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * FallbackRow — minimal row for "Not in your Disco" suggestions pulled
 * from the external search. No heart, no duration, no playlist action;
 * just art + text + Oye. The Oye button renders in the grey-faded state
 * (not in disco yet) and cooks on tap — same unified narralogy.
 */
const FallbackRow = ({ track, onClick }: { track: Track; onClick: () => void }) => (
  <div
    className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03] transition-colors rounded-xl"
  >
    <button
      onClick={onClick}
      className="relative w-11 h-11 rounded-lg overflow-hidden flex-shrink-0 voyo-tap-scale"
      aria-label={`Play ${track.title}`}
    >
      <SmartImage
        src={track.coverUrl}
        alt=""
        className="w-full h-full object-cover"
        trackId={track.trackId}
        artist={track.artist}
        title={track.title}
      />
    </button>
    <button onClick={onClick} className="flex-1 min-w-0 text-left voyo-tap-scale">
      <p className="font-medium truncate text-[14px] text-white/85">{track.title}</p>
      <p className="text-white/40 text-[12px] truncate">{track.artist}</p>
    </button>
    <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      <OyeButton track={track} size="sm" />
    </div>
  </div>
);

// Song Row Component with Hover Preview
const SongRow = ({
  track,
  index,
  isLiked = false,
  cacheQuality,
  onClick,
  onLike,
  onAddToPlaylist
}: {
  track: Track;
  index: number;
  isLiked?: boolean;
  cacheQuality?: 'standard' | 'boosted' | null; // null = not cached
  onClick: () => void;
  onLike: () => void;
  onAddToPlaylist: () => void;
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const currentTrack = usePlayerStore(s => s.currentTrack);

  // Detect if device has hover capability (desktop)
  const hasHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // Tap = play the full track immediately. (30s teaser preview removed.)
  const handleClick = () => {
    onClick();
  };

  const isCurrentTrack = currentTrack?.id === track.id;

  return (
    <div
      className="relative flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors rounded-xl group"
      onMouseEnter={() => hasHover && setIsHovered(true)}
      onMouseLeave={() => hasHover && setIsHovered(false)}
    >
      {/* Thumbnail */}
      <button
        className="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0"
        onClick={handleClick}
      >
        <SmartImage
          src={getYouTubeThumbnail(track.trackId, 'medium')}
          alt={track.title}
          className="w-full h-full object-cover"
          trackId={track.trackId}
          artist={track.artist}
          title={track.title}
        />

        {/* Hover Overlay with Play/Queue buttons - Desktop only */}
        {hasHover && (
          <>
            {isHovered && (
              <div
                className="absolute inset-0 bg-black/60 flex items-center justify-center gap-2"
              >
                <button
                  className="w-7 h-7 rounded-full bg-purple-500 flex items-center justify-center"
                  onClick={handleClick}
                >
                  <Play className="w-3 h-3 text-white fill-white ml-0.5" />
                </button>
                <OyeButton track={track} size="sm" />

              </div>
            )}
          </>
        )}
      </button>

      {/* Info */}
      <button
        className="flex-1 min-w-0 text-left"
        onClick={handleClick}
      >
        <p className={`font-medium truncate ${isCurrentTrack ? 'text-purple-400' : 'text-white'}`}>
          {track.title}
        </p>
        <div className="flex items-center gap-2">
          <p className="text-white/50 text-sm truncate">{track.artist}</p>
          {cacheQuality === 'boosted' && (
            <span className="text-xs text-[#D4A053] font-medium">
              HD
            </span>
          )}
          {cacheQuality === 'standard' && (
            <span className="text-xs text-white/60 font-medium">
              Offline
            </span>
          )}
        </div>
      </button>

      {/* Duration */}
      <div className="flex items-center gap-1 text-white/40 text-sm">
        <Clock className="w-3 h-3" />
        <span>{track.duration || '3:45'}</span>
      </div>

      {/* Heart button: tap to like, hold to add to playlist */}
      <button
        className="p-2 relative"
        onClick={(e) => { e.stopPropagation(); onLike(); }}
        onPointerDown={(e) => {
          e.stopPropagation();
          // Start long press timer (500ms)
          const timer = setTimeout(() => {
            onAddToPlaylist();
          }, 500);
          (e.currentTarget as any).__longPressTimer = timer;
        }}
        onPointerUp={(e) => {
          clearTimeout((e.currentTarget as any).__longPressTimer);
        }}
        onPointerLeave={(e) => {
          clearTimeout((e.currentTarget as any).__longPressTimer);
        }}
      >
        <Heart
          className={`w-5 h-5 transition-colors ${isLiked ? 'text-purple-500 fill-purple-500' : 'text-white/40'}`}
        />
      </button>
    </div>
  );
};

interface LibraryProps {
  onTrackClick: (track: Track) => void;
}

export const Library = ({ onTrackClick }: LibraryProps) => {
  const [activeFilter, setActiveFilterRaw] = useState('all');
  // Wrapper: save outgoing filter's scroll position, restore incoming
  // filter's. Runs even on the initial tap-to-switch gesture so user
  // never loses their place mid-list.
  const setActiveFilter = useCallback((next: string) => {
    setActiveFilterRaw((prev) => {
      if (prev === next) return prev;
      const el = scrollContainerRef.current;
      if (el) scrollMemoryRef.current.set(prev, el.scrollTop);
      // Restore on the next paint so React has mounted the new list first.
      requestAnimationFrame(() => {
        const saved = scrollMemoryRef.current.get(next) ?? 0;
        const elNow = scrollContainerRef.current;
        if (elNow) elNow.scrollTop = saved;
      });
      return next;
    });
  }, []);
  const [searchQuery, setSearchQuery] = useState('');
  const [playlistModalTrack, setPlaylistModalTrack] = useState<Track | null>(null);
  // DiscoExplainer — triggered from the "My Disco" heading.
  const [discoExplainerOpen, setDiscoExplainerOpen] = useState(false);

  // Secondary filter — when a playlist chip is selected, we intersect
  // the primary filter's result set with that playlist's trackIds. null
  // = no playlist filter active. Separate from activeFilter so users
  // can pivot e.g. "Liked ∩ Road Trip" without losing either axis.
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);

  // Play-mode state — drives the big bronze play button. Magic Mix uses
  // the Smart Mix algorithm for Liked + falls back to a simple shuffle
  // elsewhere; In Order sorts per sortMode; Shuffle is pure random.
  const [playMode, setPlayMode] = useState<PlayMode>('magic');
  const [sortMode, setSortMode] = useState<SortMode>('date-desc');
  const [playMenuOpen, setPlayMenuOpen] = useState(false);

  // "Not in your Disco" fallback results. When the user types a query
  // that returns few/no library matches, we pull a handful of tracks
  // from the external search and show them below the library list with
  // grey-faded Oye buttons. Tapping a row plays the track (iframe
  // optimistic path); tapping Oye cooks it into Disco.
  const [ytResults, setYtResults] = useState<SearchResult[]>([]);
  const [ytLoading, setYtLoading] = useState(false);
  const ytSearchIdRef = useRef(0);
  const queue = usePlayerStore(s => s.queue);
  const history = usePlayerStore(s => s.history);
  const playlists = usePlaylistStore(s => s.playlists);

  // Get liked tracks from preference store (persisted to localStorage)
  const trackPreferences = usePreferenceStore(s => s.trackPreferences);
  const setExplicitLike = usePreferenceStore(s => s.setExplicitLike);

  // Per-filter scroll position memory — tap a filter tab, library
  // restores the previous scroll position for that filter instead of
  // dropping the user back to the top. Liked tracks buried mid-list
  // stay reachable across tab switches.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollMemoryRef = useRef<Map<string, number>>(new Map());

  // Primary filter row — the five fixed tabs. Playlists live in their
  // own sub-row below so they can intersect with whichever primary tab
  // is active.
  const filters = BASE_FILTERS;

  // Compute liked tracks set from preferences
  const likedTracks = useMemo(() => {
    const liked = new Set<string>();
    Object.entries(trackPreferences).forEach(([trackId, pref]) => {
      if (pref.explicitLike === true) {
        liked.add(trackId);
      }
    });
    return liked;
  }, [trackPreferences]);

  // Get boosted tracks from download store (fine-grained selectors)
  const cachedTracks = useDownloadStore(s => s.cachedTracks);
  const initDownloads = useDownloadStore(s => s.initialize);
  const isInitialized = useDownloadStore(s => s.isInitialized);

  // Initialize download store on mount
  useEffect(() => {
    if (!isInitialized) {
      initDownloads();
    }
  }, [initDownloads, isInitialized]);

  // Convert cached tracks to Track format for display
  const boostedTracks: Track[] = cachedTracks.map(cached => ({
    id: cached.id,
    trackId: cached.id,
    title: cached.title,
    artist: cached.artist,
    coverUrl: getYouTubeThumbnail(cached.id, 'high'),
    tags: [],
    oyeScore: 0,
    duration: 0,
    createdAt: new Date().toISOString(),
  }));

  // Create maps for quick lookup of cached tracks and their quality
  const cachedTrackIds = new Set(cachedTracks.map(t => t.id));
  const trackQualityMap = new Map(cachedTracks.map(t => [t.id, t.quality]));

  // Compose pipeline:
  //   1. primary filter picks the base set (all / liked / disco / bucket / history)
  //   2. optional playlist intersection narrows it further
  //   3. searchQuery narrows by substring
  //   4. sort/shuffle applied by the active play mode
  // Every input is reactive via zustand selectors / useMemo, so adds,
  // removes, merges, and cross-session updates flow through naturally —
  // no manual invalidation.
  const filteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch = (track: Track) =>
      !q ||
      track.title.toLowerCase().includes(q) ||
      track.artist.toLowerCase().includes(q);

    // ── Step 1: base set by primary filter ───────────────────────
    let base: Track[];
    switch (activeFilter) {
      case 'bucket':
        base = queue.map(q => q.track);
        break;
      case 'history':
        base = [...history].reverse().map(h => h.track);
        break;
      case 'disco':
        // Locally downloaded tracks — certified-offline. The Disco tab
        // is the "guaranteed to play instantly, even without network"
        // slice. Differs from "All" which includes curated library
        // tracks that rely on R2 edge (online-only in worst case).
        base = boostedTracks;
        break;
      case 'liked':
        base = TRACKS.filter(t => likedTracks.has(t.id));
        break;
      default:
        // "All" = curated library ∪ locally cached, deduped by id.
        const seen = new Set<string>();
        base = [];
        for (const t of TRACKS) { if (!seen.has(t.id)) { seen.add(t.id); base.push(t); } }
        for (const t of boostedTracks) { if (!seen.has(t.id)) { seen.add(t.id); base.push(t); } }
    }

    // ── Step 2: intersect with playlist if selected ──────────────
    if (activePlaylistId) {
      const playlist = playlists.find(p => p.id === activePlaylistId);
      if (!playlist) {
        base = [];
      } else {
        const ids = new Set(playlist.trackIds);
        base = base.filter(t => ids.has(t.trackId) || ids.has(t.id));
      }
    }

    // ── Step 3: search narrowing ─────────────────────────────────
    return base.filter(matchesSearch);
  }, [activeFilter, activePlaylistId, searchQuery, boostedTracks, queue, history, playlists, likedTracks]);

  // Sort / shuffle for both display AND play-all. Memoised from
  // filteredTracks + playMode + sortMode so the displayed order
  // matches what Big Play will enqueue.
  const orderedTracks = useMemo<Track[]>(() => {
    if (filteredTracks.length === 0) return filteredTracks;

    if (playMode === 'shuffle') {
      // Deterministic-per-session shuffle so the list doesn't reshuffle
      // mid-interaction. Seed ties to filter id + today so the order
      // stays stable across tab flips within the session.
      const seed = (activeFilter + (activePlaylistId ?? '') + Math.floor(Date.now() / 3600000)).split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
      return [...filteredTracks]
        .map((t, i) => ({ t, k: ((seed ^ (i * 2654435761)) >>> 0) }))
        .sort((a, b) => a.k - b.k)
        .map(x => x.t);
    }

    if (playMode === 'magic') {
      // Magic Mix — anti-burial tiers on Liked (surface forgotten
      // favorites), simple deterministic shuffle elsewhere.
      if (activeFilter === 'liked') {
        const now = Date.now();
        const day7 = 7 * 24 * 60 * 60 * 1000;
        const day30 = 30 * 24 * 60 * 60 * 1000;
        const dayKey = Math.floor(now / 86400000);
        const seedHash = (s: string) => {
          let h = dayKey * 9301;
          for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
          return h;
        };
        const tierFor = (t: Track): number => {
          const lp = trackPreferences[t.id]?.lastPlayedAt;
          if (!lp) return 0;
          const age = now - new Date(lp).getTime();
          if (age > day30) return 1;
          if (age > day7) return 2;
          return 3;
        };
        return filteredTracks
          .map(t => ({ t, tier: tierFor(t), sh: seedHash(t.id) }))
          .sort((a, b) => a.tier - b.tier || a.sh - b.sh)
          .map(x => x.t);
      }
      // Non-liked: defer to shuffle with a stable seed
      const seed = (activeFilter + 'magic').split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
      return [...filteredTracks]
        .map((t, i) => ({ t, k: ((seed ^ (i * 2654435761)) >>> 0) }))
        .sort((a, b) => a.k - b.k)
        .map(x => x.t);
    }

    // In Order
    const cmpTitle = (a: Track, b: Track) => a.title.localeCompare(b.title);
    const cmpDate = (a: Track, b: Track) => {
      const at = trackPreferences[a.id]?.lastPlayedAt;
      const bt = trackPreferences[b.id]?.lastPlayedAt;
      const av = at ? new Date(at).getTime() : 0;
      const bv = bt ? new Date(bt).getTime() : 0;
      return bv - av; // newest first by default
    };
    const sorted = [...filteredTracks];
    switch (sortMode) {
      case 'a-z':      sorted.sort(cmpTitle); break;
      case 'z-a':      sorted.sort((a, b) => -cmpTitle(a, b)); break;
      case 'date-asc': sorted.sort((a, b) => -cmpDate(a, b)); break;
      default:         sorted.sort(cmpDate);
    }
    return sorted;
  }, [filteredTracks, playMode, sortMode, activeFilter, activePlaylistId, trackPreferences]);

  const handleTrackClick = (track: Track) => {
    // Use onTrackClick which goes through PlaybackOrchestrator
    // No need for manual setCurrentTrack/togglePlay - orchestrator handles it
    onTrackClick(track);
  };

  // Debounced external search for the "Not in your Disco" section. Fires
  // only when the user's query is meaningful (3+ chars) and only if the
  // library list didn't already surface enough matches. Stale-guard via
  // ytSearchIdRef so rapid typing doesn't let an old response overwrite
  // a newer one.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 3) {
      setYtResults([]);
      setYtLoading(false);
      return;
    }
    const myId = ++ytSearchIdRef.current;
    const handle = window.setTimeout(async () => {
      setYtLoading(true);
      try {
        const results = await searchMusic(q, 12);
        if (ytSearchIdRef.current !== myId) return; // superseded
        setYtResults(results);
      } catch {
        if (ytSearchIdRef.current === myId) setYtResults([]);
      } finally {
        if (ytSearchIdRef.current === myId) setYtLoading(false);
      }
    }, 420);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  // Dedupe: if a YT result is already in the library (or was just cooked
  // and landed there), don't show it twice.
  const libraryIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of TRACKS) { s.add(t.trackId); s.add(t.id); }
    for (const t of boostedTracks) { s.add(t.trackId); s.add(t.id); }
    return s;
  }, [boostedTracks]);

  const ytOnlyResults = useMemo(
    () => ytResults.filter(r => !libraryIds.has(r.voyoId)),
    [ytResults, libraryIds],
  );

  // Convert SearchResult → Track for the Oye button / play pipeline.
  // Same shape SearchOverlayV2 uses.
  const resultToTrack = useCallback((result: SearchResult): Track => ({
    id: result.voyoId,
    title: result.title,
    artist: result.artist,
    album: 'VOYO',
    trackId: result.voyoId,
    coverUrl: result.thumbnail,
    tags: ['disco-fallback'],
    mood: 'afro',
    region: 'NG',
    oyeScore: result.views || 0,
    duration: 0,
    createdAt: new Date().toISOString(),
  }), []);

  const handleLike = (trackId: string) => {
    // Toggle like - persisted to localStorage via preferenceStore
    const currentlyLiked = likedTracks.has(trackId);
    setExplicitLike(trackId, !currentlyLiked);
  };

  // Query-driven: when user is searching and the library didn't yield
  // enough matches, pull "Not in your Disco" fallback rows. Kept small
  // (max ~10) so the library list stays the focus.
  const showFallback = searchQuery.trim().length >= 3 && ytOnlyResults.length > 0;
  const fallbackCount = Math.min(ytOnlyResults.length, 10);

  const emptyStateCopy = (() => {
    switch (activeFilter) {
      case 'disco': return 'No tracks downloaded yet — tap ⚡ Oye on any song and it lands here, ready to play offline.';
      case 'bucket': return 'Add tracks to your bucket to queue them up.';
      case 'history': return 'Your listening history will appear here.';
      case 'liked': return 'Tap ⚡ Oye on songs you love — they collect here.';
      default:
        return searchQuery
          ? 'Nothing in your Disco matches yet — check the suggestions below.'
          : 'Your Disco is empty. Play anything and it grows from there.';
    }
  })();

  // Big Play — enqueues orderedTracks and plays from index 0 in the
  // active mode. Clears any existing queue so the user's tap cleanly
  // replaces what was there.
  const playTrackAction = usePlayerStore(s => s.playTrack);
  const clearQueue = usePlayerStore(s => s.clearQueue);
  const addToQueue = usePlayerStore(s => s.addToQueue);
  const handlePlayAll = useCallback(() => {
    if (orderedTracks.length === 0) return;
    try { clearQueue?.(); } catch { /* optional */ }
    const [first, ...rest] = orderedTracks;
    playTrackAction(first);
    for (const t of rest) { addToQueue(t); }
    setPlayMenuOpen(false);
  }, [orderedTracks, playTrackAction, clearQueue, addToQueue]);

  const modeLabel =
    playMode === 'magic'    ? 'Magic Mix'
    : playMode === 'shuffle' ? 'Shuffle'
    : sortMode === 'a-z'     ? 'A → Z'
    : sortMode === 'z-a'     ? 'Z → A'
    : sortMode === 'date-asc' ? 'Oldest first'
    : 'Newest first';

  return (
    <div className="flex flex-col h-full">
      {/* ── Sticky chrome: heading + search + filter tabs, no animation games ── */}
      <div className="flex-shrink-0 pt-5">
        {/* Heading — tap opens the DiscoExplainer briefing. One bronze
            signature element, no subtitle, no decorative chrome. */}
        <button
          type="button"
          onClick={() => setDiscoExplainerOpen(true)}
          className="block w-full text-left px-4 pb-3 voyo-tap-scale"
          aria-label="What is Disco?"
        >
          <h1
            className="text-[28px] font-display font-bold tracking-tight"
            style={{
              color: 'rgba(232, 208, 158, 0.96)',
              textShadow: '0 0 18px rgba(212,175,110,0.18)',
              letterSpacing: '-0.01em',
              fontFamily: "'Satoshi', sans-serif",
            }}
          >
            My Disco
          </h1>
        </button>

        {/* Search bar — bronze focus ring, dark glass base */}
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-white/40 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search…"
              className="w-full pl-11 pr-4 py-[11px] rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/30 focus:outline-none transition-colors text-[14px]"
              onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(212,175,110,0.45)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = ''; }}
            />
          </div>
        </div>

        {/* Primary filter tabs — the five fixed sets. */}
        <div className="flex gap-2 px-4 pb-2 overflow-x-auto scrollbar-hide">
          {filters.map((filter) => {
            const isActive = activeFilter === filter.id;
            return (
              <button
                key={filter.id}
                className="px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-all voyo-tap-scale"
                style={
                  isActive
                    ? {
                        background: 'rgba(212, 175, 110, 0.14)',
                        color: 'rgba(232, 208, 158, 0.97)',
                        border: '1px solid rgba(212, 175, 110, 0.32)',
                        boxShadow: '0 0 14px -6px rgba(212,175,110,0.45)',
                      }
                    : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)', border: '1px solid transparent' }
                }
                onClick={() => setActiveFilter(filter.id)}
              >
                {filter.label}
                {filter.id === 'bucket' && queue.length > 0 && (
                  <span
                    className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full"
                    style={{
                      background: isActive ? 'rgba(20,12,6,0.35)' : 'rgba(212,175,110,0.18)',
                      color: 'rgba(232,208,158,0.95)',
                    }}
                  >
                    {queue.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Playlist sub-row — intersects with whichever primary filter is
            active. "All" = no playlist filter. Purple accent differentiates
            from primary tabs (bronze). Only shows when user has playlists. */}
        {playlists.length > 0 && (
          <div className="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide">
            <button
              key="__all"
              className="px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-all voyo-tap-scale"
              style={
                activePlaylistId === null
                  ? {
                      background: 'rgba(139, 92, 246, 0.14)',
                      color: 'rgba(196, 181, 253, 0.96)',
                      border: '1px solid rgba(139, 92, 246, 0.30)',
                    }
                  : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.45)', border: '1px solid transparent' }
              }
              onClick={() => setActivePlaylistId(null)}
            >
              All playlists
            </button>
            {playlists.map((p) => {
              const isActive = activePlaylistId === p.id;
              return (
                <button
                  key={p.id}
                  className="px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-all voyo-tap-scale"
                  style={
                    isActive
                      ? {
                          background: 'rgba(139, 92, 246, 0.14)',
                          color: 'rgba(196, 181, 253, 0.96)',
                          border: '1px solid rgba(139, 92, 246, 0.30)',
                        }
                      : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.45)', border: '1px solid rgba(139,92,246,0.10)' }
                  }
                  onClick={() => setActivePlaylistId(isActive ? null : p.id)}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Scroll list — tracks + the "Not in your Disco" fallback ── */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
        style={{ paddingBottom: 'calc(76px + env(safe-area-inset-bottom, 0px))' }}
      >
        {/* Inline count + active mode tag — no separate banner row. */}
        <div className="px-4 pt-2 pb-1 flex items-center gap-2 text-[11px] text-white/35 tracking-wide">
          <span>
            {orderedTracks.length} {
              activeFilter === 'disco'   ? 'offline-ready'
              : activeFilter === 'bucket'  ? 'in bucket'
              : activeFilter === 'history' ? 'played'
              : activeFilter === 'liked'   ? 'liked'
              : orderedTracks.length === 1 ? 'track' : 'tracks'
            }
          </span>
          {activePlaylistId && (
            <>
              <span className="text-white/20">·</span>
              <span className="text-[rgba(196,181,253,0.85)]">filtered by playlist</span>
            </>
          )}
        </div>

        {orderedTracks.length > 0 ? (
          orderedTracks.map((track, index) => (
            <div key={track.id} className={index === 0 ? 'relative' : ''}>
              <SongRow
                track={track}
                index={index}
                isLiked={likedTracks.has(track.id)}
                cacheQuality={trackQualityMap.get(track.trackId) || null}
                onClick={() => handleTrackClick(track)}
                onLike={() => handleLike(track.id)}
                onAddToPlaylist={() => setPlaylistModalTrack(track)}
              />
              {/* Big Play button lives inline with the first (most recent)
                  row — breaks the visual rhythm intentionally, anchors the
                  "play what's showing" affordance where the eye lands. */}
              {index === 0 && (
                <PlayAllButton
                  modeLabel={modeLabel}
                  onPlay={handlePlayAll}
                  onLongPress={() => setPlayMenuOpen(true)}
                />
              )}
            </div>
          ))
        ) : !showFallback && (
          <div className="flex flex-col items-center justify-center py-12 text-white/40">
            <VoyoIcon name="vinyl-disc" size={64} glow style={{ opacity: 0.45, marginBottom: 12 }} />
            <p className="text-sm text-center max-w-[280px] px-4">{emptyStateCopy}</p>
          </div>
        )}

        {/* ── "Not in your Disco" — grey-faded Oye rows that tap to cook.
            Only shows when user has an active query AND fallback rows
            deduped against the library. Label divider ties the section
            to the DiscoExplainer vocabulary. */}
        {showFallback && (
          <div className="mt-6">
            <div className="flex items-center gap-3 px-4 pb-2 pt-2">
              <span
                className="text-[10px] font-semibold tracking-[0.22em] uppercase"
                style={{ color: 'rgba(255,255,255,0.38)' }}
              >
                Not in your Disco
              </span>
              <div className="flex-1 h-[1px]" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.02) 100%)' }} />
            </div>
            {ytOnlyResults.slice(0, fallbackCount).map((result) => {
              const track = resultToTrack(result);
              return <FallbackRow key={result.voyoId} track={track} onClick={() => handleTrackClick(track)} />;
            })}
          </div>
        )}

        {ytLoading && searchQuery.trim().length >= 3 && ytOnlyResults.length === 0 && (
          <div className="px-4 py-6 text-center text-[11px] text-white/30 tracking-wide">
            Looking beyond your Disco…
          </div>
        )}
      </div>

      {/* Play-mode menu — long-press on the Big Play button opens it. */}
      <PlayModeMenu
        open={playMenuOpen}
        onClose={() => setPlayMenuOpen(false)}
        playMode={playMode}
        setPlayMode={setPlayMode}
        sortMode={sortMode}
        setSortMode={setSortMode}
        onPlayNow={handlePlayAll}
      />

      {/* Playlist Modal */}
      {playlistModalTrack && (
        <PlaylistModal
          isOpen={!!playlistModalTrack}
          onClose={() => setPlaylistModalTrack(null)}
          trackId={playlistModalTrack.trackId}
          trackTitle={playlistModalTrack.title}
        />
      )}

      {/* Disco explainer — triggered by tapping the "My Disco" heading */}
      <DiscoExplainer open={discoExplainerOpen} onClose={() => setDiscoExplainerOpen(false)} />
    </div>
  );
};

export default Library;
