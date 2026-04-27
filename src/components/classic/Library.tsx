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
import { getThumb } from '../../utils/thumbnail';
import { getUserTopTracks } from '../../services/personalization';
import { SmartImage } from '../ui/SmartImage';
import { Track } from '../../types';
import { PlaylistModal } from '../playlist/PlaylistModal';
import { OyeButton } from '../oye/OyeButton';
import { DiscoExplainer } from '../ui/DiscoExplainer';
import { searchMusic, SearchResult } from '../../services/api';
import { useTabHistory } from '../../hooks/useTabHistory';
import { CardHoldActions } from '../ui/CardHoldActions';
import { useKnowledgeStore } from '../../knowledge/KnowledgeStore';

// Base filter tabs — three clean primary sets. Collapsed from five to
// match the narralogy: 'My Disco' is your gold-filled (Oye'd) tracks,
// 'Oyed' is the broader gravity field — anything in your bucket OR
// cached locally (the union of the old Bucket + Disco tabs), and
// 'Just Played' replaces History with a verb users feel rather than
// read. 'All' was redundant with My Disco + Oyed combined; dropped.
// Playlists render as a SECONDARY chip row so they can intersect with
// the primary filter instead of crowding the same space.
const BASE_FILTERS = [
  { id: 'my-disco',    label: 'My Disco' },
  { id: 'oyed',        label: 'Oyed' },
  { id: 'just-played', label: 'Just Played' },
];

type PlayMode = 'magic' | 'in-order' | 'shuffle';
type SortMode = 'date-desc' | 'date-asc' | 'a-z' | 'z-a';

/**
 * PlayAllBar — dedicated play row above the track list. Iteration of
 * the previous inline-on-first-row design: detached so the gesture
 * has its own breathing room, bigger button (14×14), mode tag moved
 * next to the button as a readable chip. Tap fires the active mode;
 * long-press (420ms) opens the mode menu. Hairline bronze rail at
 * the bottom gives the separation the user asked for without a
 * heavy divider.
 */
const PlayAllBar = ({
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

  // Cleanup on unmount — if the filter flips to an empty set while the
  // user is mid-press, the pending timer would fire onLongPress against
  // an unmounted component (React warning + minor leak). Clear it here.
  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

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
    <div className="px-4 pt-3 pb-4">
      <div className="flex items-center gap-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (firedLongPress.current) return;
            onPlay();
          }}
          onPointerDown={(e) => { e.stopPropagation(); startPress(); }}
          onPointerUp={endPress}
          onPointerCancel={endPress}
          onPointerLeave={endPress}
          className="relative w-14 h-14 rounded-full flex items-center justify-center voyo-tap-scale voyo-hover-scale flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, #E6B865 0%, #D4A053 50%, #C4943D 100%)',
            boxShadow:
              '0 10px 26px -6px rgba(212,175,110,0.55), inset 0 1px 0 rgba(255,255,255,0.38), inset 0 -1px 0 rgba(0,0,0,0.18)',
            border: '1px solid rgba(255,255,255,0.25)',
          }}
          aria-label="Play all"
        >
          <Play className="w-[20px] h-[20px]" fill="#1b1206" style={{ color: '#1b1206' }} />
        </button>

        <div className="flex flex-col min-w-0">
          <span
            className="text-[14px] font-semibold leading-tight tracking-tight"
            style={{ color: 'rgba(232,208,158,0.95)' }}
          >
            Play
          </span>
          <span
            className="text-[11px] text-white/45 leading-tight mt-0.5 tracking-wide truncate"
          >
            {modeLabel} · long-press to switch
          </span>
        </div>
      </div>
      {/* Hairline bronze rail — separates the play affordance from the
          list below without heavy ornament. */}
      <div
        className="h-[1px] mt-4 rounded-full"
        style={{
          background:
            'linear-gradient(90deg, rgba(212,175,110,0.22) 0%, rgba(212,175,110,0.08) 50%, rgba(212,175,110,0.0) 100%)',
        }}
      />
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
          <button onClick={() => pick('magic')} className="px-4 py-2.5 rounded-full text-left text-[13px] font-semibold voyo-tap-scale" style={pillStyle(playMode === 'magic')}>
            Magic Mix
            <span className="ml-2 text-[11px] opacity-60">smart mix · rotates daily · surfaces forgotten favourites</span>
          </button>

          <button onClick={() => pick('in-order')} className="px-4 py-2.5 rounded-full text-left text-[13px] font-semibold voyo-tap-scale flex items-center justify-between" style={pillStyle(playMode === 'in-order')}>
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
                  className="px-3 py-1 rounded-full text-[11px] font-semibold voyo-tap-scale"
                  style={pillStyle(playMode === 'in-order' && sortMode === id)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <button onClick={() => pick('shuffle')} className="px-4 py-2.5 rounded-full text-left text-[13px] font-semibold voyo-tap-scale" style={pillStyle(playMode === 'shuffle')}>
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
  const [activeFilter, setActiveFilterRaw] = useState('my-disco');
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
  const knowledgeTracks = useKnowledgeStore(s => s.tracks);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inYourLoop = useMemo(() => getUserTopTracks(10), [history]);

  // Unified track lookup — covers every source a user may have encountered:
  // history (persisted), queue, KnowledgeStore (persisted), and the curated seed.
  // This is what makes Liked work for OYÉd tracks that aren't in TRACKS.
  const allKnownTracks = useMemo<Map<string, Track>>(() => {
    const map = new Map<string, Track>();
    const edge = `https://voyo-edge.dash-webtv.workers.dev`;
    // Seed from TRACKS first (lowest priority, gets overwritten by richer data)
    for (const t of TRACKS) map.set(t.id, t);
    // KnowledgeStore — all discovered tracks with title + artist
    for (const [id, k] of knowledgeTracks) {
      if (!map.has(id)) {
        map.set(id, {
          id,
          trackId: id,
          title: k.title,
          artist: k.artistName,
          coverUrl: `${edge}/art/${id}?quality=medium`,
          tags: [],
          oyeScore: 0,
          duration: k.duration ?? 0,
          createdAt: new Date(k.discoveredAt).toISOString(),
        });
      }
    }
    // History + queue — have the most complete Track objects (cover already resolved)
    for (const h of history) { if (h.track?.id) map.set(h.track.id, h.track); }
    for (const qi of queue) { if (qi.track?.id) map.set(qi.track.id, qi.track); }
    return map;
  }, [knowledgeTracks, history, queue]);

  // Get liked tracks from preference store (persisted to localStorage)
  const trackPreferences = usePreferenceStore(s => s.trackPreferences);
  const setExplicitLike = usePreferenceStore(s => s.setExplicitLike);

  // Per-filter scroll position memory — tap a filter tab, library
  // restores the previous scroll position for that filter instead of
  // dropping the user back to the top. Liked tracks buried mid-list
  // stay reachable across tab switches.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollMemoryRef = useRef<Map<string, number>>(new Map());

  // Chrome-retreat pattern: the heading fades out while the user is
  // actively scrolling, then fades back in once they go idle (~1.1s
  // after the last scroll tick). Doesn't translate position — only
  // opacity — so it never shifts layout. At scroll=0 we always show
  // full opacity regardless of idle state.
  const [isScrolled, setIsScrolled] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const lastScrollTopRef = useRef(0);
  const onListScroll = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollContainerRef.current;
      if (!el) return;
      const top = el.scrollTop;
      // Threshold so a one-pixel jitter doesn't trip the state machine.
      const wasScrolled = lastScrollTopRef.current > 40;
      const nowScrolled = top > 40;
      lastScrollTopRef.current = top;
      if (nowScrolled !== wasScrolled) setIsScrolled(nowScrolled);
      // Arm the idle flag: true while ticks are arriving, false after
      // 1100ms of silence. Feels like the chrome "breathes back in"
      // when the user stops interacting.
      setIsScrolling(true);
      if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
      scrollIdleTimerRef.current = setTimeout(() => setIsScrolling(false), 1100);
    });
  }, []);
  useEffect(() => () => {
    if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
    if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
  }, []);
  const headerOpacity = !isScrolled ? 1 : isScrolling ? 0.18 : 0.94;

  // System back peels the filter stack too — user taps My Disco → Oyed
  // → Just Played, back press returns to Oyed, then My Disco, then up
  // to the page-level back-guard. Feels layered like a native app.
  useTabHistory(activeFilter, setActiveFilter, 'library-filter');

  // Primary filter row — three fixed tabs (My Disco / Oyed / Just Played).
  // Playlists live in their own sub-row below so they can intersect with
  // whichever primary tab is active.
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
  //   1. primary filter picks the base set (my-disco / oyed / just-played)
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
      case 'just-played':
        base = [...history].reverse().map(h => h.track);
        break;
      case 'oyed': {
        // Union of "in your gravity right now": current bucket (queue) ∪
        // Disco (locally cached / offline-ready). Queue first so the
        // tracks actively coming up next are at the top, then cached
        // tracks. Deduped by trackId since a tracked queued from Disco
        // would otherwise appear twice.
        const seen = new Set<string>();
        const merged: Track[] = [];
        for (const q of queue) {
          if (!seen.has(q.track.id)) { seen.add(q.track.id); merged.push(q.track); }
        }
        for (const t of boostedTracks) {
          if (!seen.has(t.id)) { seen.add(t.id); merged.push(t); }
        }
        base = merged;
        break;
      }
      case 'my-disco':
      default:
        // All OYÉd tracks (gold-filled in narralogy) — looks across EVERY
        // source (KnowledgeStore, history, queue, TRACKS), not just the
        // 27-track seed. Renamed from 'liked' 2026-04-25 to match the
        // user-facing "My Disco" label and reinforce the gold-filled =
        // your personal disco rotation read.
        base = Array.from(likedTracks)
          .map(id => allKnownTracks.get(id))
          .filter((t): t is Track => !!t);
        break;
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
  }, [activeFilter, activePlaylistId, searchQuery, boostedTracks, queue, history, playlists, likedTracks, allKnownTracks]);

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
      // Magic Mix — anti-burial tiers on My Disco (surface forgotten
      // favorites), simple deterministic shuffle elsewhere.
      if (activeFilter === 'my-disco') {
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
      case 'oyed': return 'Tap ⚡ Oye on any song — your bucket and offline-ready tracks collect here.';
      case 'just-played': return 'Your listening history will appear here.';
      case 'my-disco':
      default:
        return searchQuery
          ? 'Nothing in your Disco matches yet — check the suggestions below.'
          : 'Your Disco is empty. Tap ⚡ Oye on songs you love and they collect here.';
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

  const handleLoopPlay = useCallback((track: Track) => {
    if (inYourLoop.length === 0) return;
    try { clearQueue?.(); } catch { /* optional */ }
    const idx = inYourLoop.findIndex(t => t.id === track.id);
    const ordered = idx > 0 ? [...inYourLoop.slice(idx), ...inYourLoop.slice(0, idx)] : inYourLoop;
    const [first, ...rest] = ordered;
    playTrackAction(first);
    for (const t of rest) { addToQueue(t); }
  }, [inYourLoop, playTrackAction, clearQueue, addToQueue]);

  const modeLabel =
    playMode === 'magic'    ? 'Magic Mix'
    : playMode === 'shuffle' ? 'Shuffle'
    : sortMode === 'a-z'     ? 'A → Z'
    : sortMode === 'z-a'     ? 'Z → A'
    : sortMode === 'date-asc' ? 'Oldest first'
    : 'Newest first';

  return (
    <div className="flex flex-col h-full">
      {/* ── Sticky chrome. Header weight scales with scroll: at rest,
          "My Disco" fills the top with bronze shimmer. As the user
          scrolls into the list, the heading compresses (shrinks +
          fades) so results own the screen — same retreat pattern as
          the old layout, tighter execution via transform+opacity
          (cheap compositor-only) instead of the top↔bottom reposition
          jump that felt weak. ── */}
      <div
        className="flex-shrink-0"
        style={{
          // On notched iPhones the headline was sliding under the dynamic
          // island — the only top padding was pt-5 on the inner button (20px)
          // which doesn't clear a 47-59px notch. Push the whole sticky
          // chrome down by env(safe-area-inset-top), with a 20px floor so
          // non-notched devices keep the original spacing. Audit §5 [863-879].
          paddingTop: 'max(0px, env(safe-area-inset-top))',
        }}
      >
        <button
          type="button"
          onClick={() => setDiscoExplainerOpen(true)}
          className="block w-full text-left px-4 pt-5 pb-3 voyo-tap-scale"
          style={{
            opacity: headerOpacity,
            transition: 'opacity 380ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
          aria-label="What is Disco?"
        >
          {/* Bronze shimmer headline — same gradient as DiscoExplainer title,
              heavier weight + glow to give the page centre of gravity. */}
          <h1
            className="text-[34px] font-black leading-none tracking-tight"
            style={{
              fontFamily: "'Satoshi', sans-serif",
              background:
                'linear-gradient(90deg, #8B6228 0%, #C4943D 18%, #E6B865 35%, #FFF3D6 50%, #E6B865 65%, #C4943D 82%, #8B6228 100%)',
              backgroundSize: '240% 100%',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 18px rgba(212,160,83,0.22))',
              letterSpacing: '-0.02em',
            }}
          >
            My Disco
          </h1>
          {/* Thin bronze underline flourish — echoes GreetingBanner so
              the "daily arrival moment" language stays consistent. */}
          <div
            className="h-[1.5px] mt-1.5 rounded-full"
            style={{
              width: '34%',
              background:
                'linear-gradient(90deg, rgba(212,160,83,0.85) 0%, rgba(230,184,101,0.5) 50%, rgba(212,160,83,0.08) 100%)',
            }}
          />
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
              // 16px floor on the input prevents iOS Safari from auto-zooming
              // the viewport on focus. Visual weight stays close to the old
              // 14px because the placeholder/text is naturally compact in
              // Satoshi at this size — the gain (no zoom-jolt) outweighs the
              // tiny extra heft. Cross-references global base-layer 16px
              // floor (research §1 #8) — input is the offender, fix here.
              className="w-full pl-11 pr-4 py-[11px] rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/30 focus:outline-none transition-colors text-[16px]"
              onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(212,175,110,0.45)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = ''; }}
            />
          </div>
        </div>

        {/* Primary filter tabs — three fixed sets. */}
        <div className="flex gap-2 px-4 pb-2 overflow-x-auto scrollbar-hide">
          {filters.map((filter) => {
            const isActive = activeFilter === filter.id;
            return (
              <button
                key={filter.id}
                // Bump to 44px floor on hit area without changing the visual
                // pill weight much — most-tapped row in Library, must clear
                // the touch-target floor (audit §5 [932-942]). py-2 + min-h
                // gives a 40-44px tall chip; px-4 widens slightly for finger.
                className="px-4 py-2 min-h-[44px] inline-flex items-center justify-center rounded-full text-[13px] font-semibold whitespace-nowrap transition-all voyo-tap-scale"
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
                {filter.id === 'oyed' && queue.length > 0 && (
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
              className="px-3 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all voyo-tap-scale"
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
                  className="px-3 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all voyo-tap-scale"
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
        onScroll={onListScroll}
        className="flex-1 overflow-y-auto"
        // overscrollBehavior: 'contain' caps vertical rubber-band inside this
        // list — without it, the bounce leaks past the parent (which has
        // overscroll-behavior: none) and produces a visible header jolt at
        // both edges (research §3.5 #5). Containment keeps the scroll inertia
        // local to the Library list, which is what the user expects.
        style={{
          paddingBottom: 'calc(76px + env(safe-area-inset-bottom, 0px))',
          overscrollBehavior: 'contain',
        }}
      >
        {/* Inline count + active mode tag — no separate banner row. */}
        <div className="px-4 pt-2 pb-1 flex items-center gap-2 text-[11px] text-white/35 tracking-wide">
          <span>
            {orderedTracks.length} {
              activeFilter === 'oyed'        ? 'in rotation'
              : activeFilter === 'just-played' ? 'played'
              : activeFilter === 'my-disco'    ? (orderedTracks.length === 1 ? 'oyé' : 'oyés')
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

        {orderedTracks.length > 0 && (
          /* Dedicated Big-Play row — detached from the first track so
             the "play what's showing" gesture has its own space + a
             clear visual separator from the list below. Slightly
             bigger button and bolder mode label — earns a bit more
             weight than when it was inline. */
          <PlayAllBar
            modeLabel={modeLabel}
            onPlay={handlePlayAll}
            onLongPress={() => setPlayMenuOpen(true)}
          />
        )}

        {/* In your Loop — only surfaces on the My Disco tab when the user
            has repeat-played tracks. Circle carousel, lives between the
            Play button and the full list so it feels like a personal
            context block, not a catalogue shelf. */}
        {activeFilter === 'my-disco' && inYourLoop.length > 0 && (
          <div className="mb-5 mt-1">
            <div className="px-4 mb-3 flex items-center gap-2">
              <span
                className="text-[11px] font-semibold tracking-[0.18em] uppercase"
                style={{
                  background: 'linear-gradient(90deg, rgba(139,92,246,0.9) 0%, rgba(167,139,250,0.7) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                In your Loop
              </span>
              <div className="h-[1px] flex-1" style={{ background: 'linear-gradient(90deg, rgba(139,92,246,0.25) 0%, transparent 100%)' }} />
            </div>
            <div className="flex gap-4 px-4 overflow-x-auto scrollbar-hide pb-1">
              {inYourLoop.map((track, i) => (
                <button
                  key={track.id}
                  className="flex-shrink-0 w-[72px]"
                  onClick={() => handleLoopPlay(track)}
                >
                  <div
                    className="relative w-[72px] h-[72px] rounded-full overflow-hidden mb-1.5 mx-auto"
                    style={{
                      boxShadow: i === 0
                        ? '0 0 0 2px rgba(139,92,246,0.55), 0 0 16px rgba(139,92,246,0.35)'
                        : '0 0 0 1px rgba(139,92,246,0.18)',
                    }}
                  >
                    <SmartImage
                      src={getThumb(track.trackId, 'medium')}
                      trackId={track.trackId}
                      alt={track.title}
                      artist={track.artist}
                      title={track.title}
                      className="w-full h-full object-cover"
                      style={{ objectPosition: 'center 30%', transform: 'scale(1.25)' }}
                      lazy={false}
                    />
                    <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.45) 100%)' }} />
                  </div>
                  <p className="text-white/80 text-[10px] font-medium truncate text-center leading-tight">{track.title.split('|')[0].trim()}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {orderedTracks.length > 0 ? (
          orderedTracks.map((track, index) => (
            <CardHoldActions key={track.id} track={track} onPlaylist={() => setPlaylistModalTrack(track)}>
              <SongRow
                track={track}
                index={index}
                isLiked={likedTracks.has(track.id)}
                cacheQuality={trackQualityMap.get(track.trackId) || null}
                onClick={() => handleTrackClick(track)}
                onLike={() => handleLike(track.id)}
                onAddToPlaylist={() => setPlaylistModalTrack(track)}
              />
            </CardHoldActions>
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
