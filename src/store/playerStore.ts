/**
 * VOYO Music - Global Player State (Zustand)
 *
 * PLAYBACK PATTERN:
 * 1. Call setCurrentTrack(track) - sets track, resets progress to 0
 * 2. If in Classic mode: call setShowNowPlaying(true) to open full player
 * 3. Call forcePlay() or togglePlay() after ~150ms delay for audio unlock
 *
 * Components should NOT auto-play - let AudioPlayer handle source detection.
 * The AudioPlayer component watches currentTrack and manages the actual <audio> element.
 *
 * Example usage in a component:
 *   const { setCurrentTrack, setShowNowPlaying, forcePlay } = usePlayerStore();
 *   const handlePlay = (track: Track) => {
 *     setCurrentTrack(track);
 *     setShowNowPlaying(true);
 *     setTimeout(() => forcePlay(), 150);
 *   };
 */
import { create } from 'zustand';
import { Track, ViewMode, QueueItem, HistoryItem, MoodType, Reaction, VoyoTab } from '../types';
import {
  TRACKS,
} from '../data/tracks';
import { getThumb } from '../utils/thumbnail';
import {
  getPoolAwareHotTracks,
  getPoolAwareDiscoveryTracks,
  getTrendingPoolTracks,
  recordPoolEngagement,
} from '../services/personalization';
import { BitrateLevel, BufferStatus } from '../services/audioEngine';

// VIBES FIRST: Database discovery from 324K tracks (lazy import to avoid circular deps)
let databaseDiscoveryModule: typeof import('../services/databaseDiscovery') | null = null;
async function getDatabaseDiscovery() {
  if (!databaseDiscoveryModule) {
    databaseDiscoveryModule = await import('../services/databaseDiscovery');
  }
  return databaseDiscoveryModule;
}
import { isKnownUnplayable } from '../services/trackVerifier';
import { isBlocked as isBlocklisted } from '../services/trackBlocklist';
import { getInsights as getOyoInsights } from '../services/oyoDJ';
import { oyo } from '../services/oyo';
import { devLog, devWarn } from '../utils/logger';
import { trace } from '../services/telemetry';

// Network quality types
type NetworkQuality = 'slow' | 'medium' | 'fast' | 'unknown';
type PrefetchStatus = 'idle' | 'loading' | 'ready' | 'error';

// AbortController for cancelling async operations on rapid track changes
let currentTrackAbortController: AbortController | null = null;

// Dedup trackers for setCurrentTime persistence — see setCurrentTime impl
let _lastPersistedSec = -1;
let _lastPortalSyncSec = -1;
// Debounce timer for volume persist — slider fires dozens of times during
// a drag. Synchronous localStorage.setItem on every position blocks the
// main thread (1-5ms each) and causes visible UI lag + audio stutter.
let _volumePersistTimer: ReturnType<typeof setTimeout> | null = null;
// Same pattern for the VOYEX spatial slider — previously stored on window
// and used an `if (!timer)` leading-throttle that silently dropped every
// drag value after the first one in each 500ms window. User's final
// slider position never persisted.
let _voyexPersistTimer: ReturnType<typeof setTimeout> | null = null;

// ============================================
// PERSISTENCE HELPERS - Remember state on refresh
// ============================================
const STORAGE_KEY = 'voyo-player-state';

// FIXED: Store FULL track info so you never lose a song
interface PersistedHistoryItem {
  trackId: string;
  title: string;
  artist: string;
  coverUrl: string;
  playedAt: string;
  duration: number;
  oyeReactions: number;
}

// FIXED: Persisted queue items now also carry title/artist/coverUrl so
// rehydration on page reload doesn't blank them to 'Loading...' for tracks
// not in the static seed array (which is most user-played tracks).
interface PersistedQueueItem {
  trackId: string;
  title?: string;
  artist?: string;
  coverUrl?: string;
  addedAt: string;
  source: 'manual' | 'auto' | 'roulette' | 'ai';
}

interface PersistedState {
  currentTrackId?: string;
  currentTrackTitle?: string;   // Full metadata so reload doesn't show "Loading..."
  currentTrackArtist?: string;
  currentTrackCoverUrl?: string;
  currentTime?: number;
  voyoActiveTab?: VoyoTab;
  queue?: PersistedQueueItem[];
  history?: PersistedHistoryItem[];
  // Playback intent at last snapshot. On rehydrate, AudioPlayer uses this to
  // decide whether to attempt auto-resume (subject to browser autoplay policy).
  wasPlaying?: boolean;
}

function loadPersistedState(): PersistedState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function savePersistedState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

// HELPER: Get recent history with FULL track info (for console access)
export function getRecentHistory(limit = 10): PersistedHistoryItem[] {
  const { history } = loadPersistedState();
  return (history || []).slice(-limit).reverse();
}

// Expose globally for easy console access
if (typeof window !== 'undefined') {
  (window as any).voyoHistory = () => {
    const history = getRecentHistory(20);
    devLog('🎵 VOYO Recent History:');
    history.forEach((h, i) => {
      devLog(`${i + 1}. ${h.title} - ${h.artist} (${new Date(h.playedAt).toLocaleTimeString()})`);
    });
    return history;
  };
  devLog('[VOYO] Type voyoHistory() in console to see recent tracks');
}

function getPersistedTrack(): Track | null {
  const persisted = loadPersistedState();
  const { currentTrackId } = persisted;
  if (currentTrackId) {
    // Try to find in static tracks (for hydration) — these have full metadata
    const track = TRACKS.find(t => t.id === currentTrackId || t.trackId === currentTrackId);
    if (track) return track;
    // Not in static array: use PERSISTED metadata (title/artist/coverUrl)
    // that we save in setCurrentTrack. This eliminates the "Loading..."
    // stub that appeared for every user-discovered track on reload —
    // the now-playing card displays correctly from the first frame.
    return {
      id: currentTrackId,
      trackId: currentTrackId,
      title: persisted.currentTrackTitle || 'Loading...',
      artist: persisted.currentTrackArtist || '',
      coverUrl: persisted.currentTrackCoverUrl || getThumb(currentTrackId),
      duration: 0,
      tags: [],
      oyeScore: 0,
      createdAt: new Date().toISOString(),
    };
  }
  return null;
}

function getPersistedQueue(): QueueItem[] {
  const { queue } = loadPersistedState();
  if (!queue || queue.length === 0) {
    // No default queue - will be populated from database
    return [];
  }
  // Hydrate queue items with full track objects.
  // We persist title/artist/coverUrl per item, so use those when the track
  // isn't in the static seed array. The previous fallback created tracks
  // with title:'Loading...' which discarded the saved metadata — that's
  // why Continue Listening / Queue / Previous showed wrong titles even
  // though Heavy Rotation (different source) showed correct ones.
  return queue
    .map((item) => {
      // Try static tracks first
      let track = TRACKS.find(t => t.id === item.trackId || t.trackId === item.trackId);
      // If not found, USE the persisted metadata (don't blank it out)
      if (!track) {
        track = {
          id: item.trackId,
          trackId: item.trackId,
          title: item.title || 'Loading...',
          artist: item.artist || '',
          coverUrl: item.coverUrl || getThumb(item.trackId),
          duration: 0,
          tags: [],
          oyeScore: 0,
          createdAt: new Date().toISOString(),
        };
      }
      return {
        track,
        addedAt: item.addedAt,
        source: item.source,
      };
    });
}

function getPersistedHistory(): HistoryItem[] {
  const { history } = loadPersistedState();
  if (!history || history.length === 0) return [];
  // Hydrate history items with full track objects.
  // Same fix as getPersistedQueue — use persisted title/artist/coverUrl
  // instead of blanking them to 'Loading...'. The localStorage already has
  // the right data; the bug was the hydration discarding it.
  return history
    .map((item) => {
      // Try static tracks first
      let track = TRACKS.find(t => t.id === item.trackId || t.trackId === item.trackId);
      // If not found, USE the persisted metadata
      if (!track) {
        track = {
          id: item.trackId,
          trackId: item.trackId,
          title: item.title || 'Loading...',
          artist: item.artist || '',
          coverUrl: item.coverUrl || getThumb(item.trackId),
          duration: 0,
          tags: [],
          oyeScore: 0,
          createdAt: new Date().toISOString(),
        };
      }
      return {
        track,
        playedAt: item.playedAt,
        duration: item.duration,
        oyeReactions: item.oyeReactions,
      };
    });
}

interface PlayerStore {
  // Current Track State
  currentTrack: Track | null;
  isPlaying: boolean;
  progress: number;
  currentTime: number;
  duration: number;
  volume: number;
  viewMode: ViewMode;
  videoTarget: 'hidden' | 'portrait' | 'landscape'; // Where to show the video iframe (replaces isVideoMode)
  videoPolitePosition: 'center' | 'bottom' | 'top-right' | 'top-left'; // Auto-position based on page context
  videoBlocked: boolean; // True when the YouTube embed is blocked for the current track (region-restricted, age-gated, embedding disabled). Audio may still play from R2/cache — we fall back to the album-art backdrop.
  seekPosition: number | null; // When set, AudioPlayer should seek to this position

  // Flag to signal that a track was selected (from search, etc.) and NowPlaying should open
  shouldOpenNowPlaying: boolean;

  // SKEEP (Fast-forward) State
  playbackRate: number; // 1 = normal, 2/4/8 = SKEEP mode
  isSkeeping: boolean; // True when holding skip button

  // Streaming Optimization (Spotify-beating features)
  networkQuality: NetworkQuality;
  streamQuality: BitrateLevel;  // Use BitrateLevel from audioEngine
  bufferHealth: number; // 0-100 percentage
  bufferStatus: BufferStatus;  // 'healthy' | 'warning' | 'emergency'
  prefetchStatus: Map<string, PrefetchStatus>; // trackId -> status
  playbackSource: 'cached' | 'iframe' | 'r2' | 'direct' | 'cdn' | null; // cached = boosted, r2 = R2 collective cache, iframe = streaming

  // Boost Audio Preset - African Bass with speaker protection
  // 🟡 boosted (Yellow) - Standard warm boost (default)
  // 🔵 calm (Blue) - Relaxed, balanced
  // 🟣 voyex (Purple) - Full holistic experience
  boostProfile: 'off' | 'boosted' | 'calm' | 'voyex';
  voyexSpatial: number;

  // OYÉ Bar Behavior - Signature VOYO element
  // 'fade' - stays visible but ghosted after timeout
  // 'disappear' - hides completely after timeout
  oyeBarBehavior: 'fade' | 'disappear';

  // OYÉ Lightning Bulb — predictive pre-warm of the upcoming queue (N+1, N+2).
  // Bulb on  → voyoStream.prewarmUpcoming fires ensureTrackReady ahead of time
  //            so the next track's audio is already in R2 when the user gets
  //            there. Deep-cut / cold-start wait vanishes on playlist flows.
  // Bulb off → purely reactive: next track is extracted only when played. Saves
  //            a small amount of bandwidth/work if the user skips a lot.
  oyePrewarm: boolean;

  // Playback Modes
  shuffleMode: boolean;
  repeatMode: 'off' | 'all' | 'one';

  // Queue & History
  queue: QueueItem[];
  history: HistoryItem[];

  // Recommendations
  hotTracks: Track[];
  aiPicks: Track[];
  discoverTracks: Track[];
  isAiMode: boolean;

  // Mood Tunnel
  currentMood: MoodType | null;

  // OYÉ Reactions
  reactions: Reaction[];
  oyeScore: number;

  // Roulette
  isRouletteMode: boolean;
  rouletteTracks: Track[];

  // VOYO Superapp Tab
  voyoActiveTab: VoyoTab;
  setVoyoTab: (tab: VoyoTab) => void;

  // Actions - Playback
  setCurrentTrack: (track: Track) => void;
  playTrack: (track: Track) => void; // CONSOLIDATED: Sets track AND starts playing in one atomic update
  togglePlay: () => void;
  // Direct setter for the audio element to sync its actual state back to the
  // store. UI buttons should NOT call this — they call togglePlay. This is
  // for the audio element's native play/pause/ended events ONLY, so the
  // store always reflects what the audio is actually doing (vs what we WANT
  // it to do, which is the togglePlay path).
  setIsPlaying: (value: boolean) => void;
  setProgress: (progress: number) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  seekTo: (time: number) => void;
  clearSeekPosition: () => void;
  setShouldOpenNowPlaying: (should: boolean) => void;
  setVolume: (volume: number) => void;
  nextTrack: () => void;
  prevTrack: () => void;
  predictNextTrack: () => Track | null; // Predict what track will play next (for preloading)
  predictUpcoming: (n?: number) => Track[];   // v214 — predict N-deep for warm-ahead preload
  toggleShuffle: () => void;
  cycleRepeat: () => void;

  // Actions - SKEEP (Fast-forward)
  setPlaybackRate: (rate: number) => void;
  startSkeep: () => void; // Begin SKEEP mode (escalating 2x → 4x → 8x)
  stopSkeep: () => void;  // Return to normal playback

  // Actions - View Mode
  cycleViewMode: () => void;
  setViewMode: (mode: ViewMode) => void;
  setVideoTarget: (target: 'hidden' | 'portrait' | 'landscape') => void;
  setVideoPolitePosition: (pos: 'center' | 'bottom' | 'top-right' | 'top-left') => void;
  setVideoBlocked: (blocked: boolean) => void;

  // Actions - Queue
  addToQueue: (track: Track, position?: number) => void;
  addTracksToQueue: (tracks: Track[]) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;

  // Actions - History
  addToHistory: (track: Track, duration: number) => void;

  // Actions - Recommendations
  refreshRecommendations: () => void;
  toggleAiMode: () => void;
  updateDiscoveryForTrack: (track: Track) => void;
  refreshDiscoveryForCurrent: () => void;

  // Actions - Mood
  setMood: (mood: MoodType | null) => void;

  // Actions - Reactions
  addReaction: (reaction: Omit<Reaction, 'id' | 'createdAt'>) => void;
  multiplyReaction: (reactionId: string) => void;
  clearReactions: () => void;

  // Actions - Roulette
  startRoulette: () => void;
  stopRoulette: (track: Track) => void;

  // Actions - Streaming Optimization
  setNetworkQuality: (quality: NetworkQuality) => void;
  setStreamQuality: (quality: BitrateLevel) => void;
  setBufferHealth: (health: number, status: BufferStatus) => void;
  setPlaybackSource: (source: 'cached' | 'iframe' | 'r2' | 'direct' | 'cdn' | null) => void;
  setPrefetchStatus: (trackId: string, status: PrefetchStatus) => void;
  detectNetworkQuality: () => void;
  setBoostProfile: (profile: 'off' | 'boosted' | 'calm' | 'voyex') => void;
  setVoyexSpatial: (value: number) => void;
  setOyeBarBehavior: (behavior: 'fade' | 'disappear') => void;
  setOyePrewarm: (enabled: boolean) => void;

  // Verse Jam — visitor is locked to a host's playback
  jammingWith: { dashId: string; name: string } | null;
  startJam: (dashId: string, name: string) => void;
  endJam: () => void;
}

// Load persisted state once at init
const _persistedState = loadPersistedState();

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  // Initial State - restored from localStorage where available
  currentTrack: getPersistedTrack(),
  isPlaying: _persistedState.wasPlaying === true,
  progress: 0,
  currentTime: _persistedState.currentTime || 0,
  duration: 0,
  volume: parseInt(localStorage.getItem('voyo-volume') || '100', 10),
  seekPosition: null,
  shouldOpenNowPlaying: false,
  viewMode: 'card',
  videoTarget: 'hidden',
  videoPolitePosition: 'center',
  videoBlocked: false,
  shuffleMode: false,
  repeatMode: 'off',

  // SKEEP Initial State
  playbackRate: 1,
  isSkeeping: false,

  // Streaming Optimization Initial State
  networkQuality: 'unknown',
  streamQuality: 'high',
  bufferHealth: 100,
  bufferStatus: 'healthy',
  prefetchStatus: new Map(),
  playbackSource: null,
  // Persist audio settings across reload. Was hardcoded defaults — user
  // lost their preset selection on every refresh.
  boostProfile: ((): 'off' | 'boosted' | 'calm' | 'voyex' => {
    try { return (localStorage.getItem('voyo-boost-profile') as 'off' | 'boosted' | 'calm' | 'voyex') || 'boosted'; } catch { return 'boosted'; }
  })(),
  voyexSpatial: ((): number => {
    try { return parseInt(localStorage.getItem('voyo-voyex-spatial') || '0', 10); } catch { return 0; }
  })(),
  oyeBarBehavior: ((): 'fade' | 'disappear' => {
    try { return (localStorage.getItem('voyo-oye-behavior') as 'fade' | 'disappear') || 'fade'; } catch { return 'fade'; }
  })(),
  oyePrewarm: ((): boolean => {
    try { return localStorage.getItem('voyo-oye-prewarm') !== 'false'; } catch { return true; }
  })(),

  // FIX 2: Persist queue and history across refreshes
  queue: getPersistedQueue(),
  history: getPersistedHistory(),

  // VIBES FIRST: Start empty, load from 324K database immediately
  // Database discovery populates these on first refreshRecommendations() call
  hotTracks: [],
  aiPicks: [],
  discoverTracks: [],
  isAiMode: true,

  currentMood: 'afro',

  reactions: [],
  oyeScore: 0,

  isRouletteMode: false,
  rouletteTracks: [], // Will be populated from database

  // Verse Jam state
  jammingWith: null,

  // VOYO Superapp Tab - restored from localStorage
  voyoActiveTab: _persistedState.voyoActiveTab || 'music',
  setVoyoTab: (tab) => {
    set({ voyoActiveTab: tab });
    // Persist tab change
    const current = loadPersistedState();
    savePersistedState({ ...current, voyoActiveTab: tab });
  },

  // Playback Actions
  setCurrentTrack: (track) => {
    const state = get();

    // RACE CONDITION FIX: Cancel previous track's async operations
    if (currentTrackAbortController) {
      currentTrackAbortController.abort();
    }
    currentTrackAbortController = new AbortController();
    const signal = currentTrackAbortController.signal;

    // Add current track to history before switching (save ALL tracks, even brief plays)
    // User requested: "make sure all songs played show in library history even if played 5s"
    if (state.currentTrack && state.currentTime > 0) {
      get().addToHistory(state.currentTrack, state.currentTime);

      // POOL ENGAGEMENT: Record completion if played significantly
      const completionRate = state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;
      if (completionRate > 30) {
        recordPoolEngagement(state.currentTrack.id, 'complete', { completionRate });
      }
    }
    set({
      currentTrack: track,
      // FIX: Don't auto-play - preserve current play state
      // isPlaying: true, // REMOVED - was causing auto-play bug
      progress: 0,
      currentTime: 0,
      seekPosition: null, // Clear seek position on track change
      // SKEEP FIX: Reset playback rate when changing tracks
      playbackRate: 1,
      isSkeeping: false,
      // FIX: Reset playback source so AudioPlayer determines fresh for new track
      // Without this, stale 'cached' value causes YouTubeIframe to mute
      playbackSource: null,
      bufferHealth: 0,
    });

    // POOL ENGAGEMENT: Record play (check abort before async op)
    if (!signal.aborted) {
      recordPoolEngagement(track.id, 'play');
    }

    // VIDEO INTELLIGENCE: Sync play to collective brain (async, non-blocking)
    if (!signal.aborted) {
      import('../lib/supabase').then(({ videoIntelligenceAPI, isSupabaseConfigured }) => {
        if (!isSupabaseConfigured || signal.aborted) return;
        const trackId = track.trackId || track.id;
        if (trackId) {
          videoIntelligenceAPI.recordPlay(trackId);
          videoIntelligenceAPI.sync({
            youtube_id: trackId,
            title: track.title,
            artist: track.artist || null,
            thumbnail_url: track.coverUrl || getThumb(trackId),
            discovery_method: 'manual_play',
          });
        }
      }).catch(() => {});
    }

    // AUTO-TRIGGER: Update smart discovery for this track (check abort)
    if (!signal.aborted) {
      get().updateDiscoveryForTrack(track);
    }

    // REFRESH HOT TRACKS: Every 3rd track change, refresh hot recommendations
    // (Not every track to avoid performance hit, but often enough to stay fresh)
    const trackChangeCount = (window as any).__voyoTrackChangeCount || 0;
    (window as any).__voyoTrackChangeCount = trackChangeCount + 1;
    if (trackChangeCount % 3 === 0) {
      const refreshTimeoutId = setTimeout(() => {
        if (!signal.aborted) {
          get().refreshRecommendations();
        }
      }, 500);
      // Cleanup on abort
      signal.addEventListener('abort', () => clearTimeout(refreshTimeoutId));
    }

    // PERSIST: Save full track metadata so it survives refresh.
    // Was saving ONLY trackId — on reload, getPersistedTrack() couldn't
    // find user-discovered tracks in the static TRACKS array and showed
    // "Loading..." stub. Now persisting title + artist + coverUrl so the
    // now-playing card displays correctly from the first frame after reload.
    const current = loadPersistedState();
    savePersistedState({
      ...current,
      currentTrackId: track.id || track.trackId,
      currentTrackTitle: track.title,
      currentTrackArtist: track.artist,
      currentTrackCoverUrl: track.coverUrl || getThumb(track.trackId || track.id),
      currentTime: 0,
    });

    // PORTAL SYNC: Update now_playing if portal is open (cancellable).
    // Deferred to requestIdleCallback — the dynamic import() resolves in
    // a microtask that runs before the next audio buffer callback. During
    // rapid skip/seek, multiple import() promises queue up and block the
    // audio thread for 2-5ms per fire. requestIdleCallback pushes it to
    // when the browser has free time.
    const runPortalSync = async () => {
      if (signal.aborted) return;
      try {
        const { useUniverseStore } = await import('./universeStore');
        if (signal.aborted) return;
        const universeStore = useUniverseStore.getState();
        if (universeStore.isPortalOpen) {
          universeStore.updateNowPlaying();
        }
      } catch {}
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(() => runPortalSync(), { timeout: 3000 });
    } else {
      setTimeout(() => runPortalSync(), 200);
    }
  },

  // CONSOLIDATED: Play a track - sets track AND isPlaying in one atomic update
  // Use this instead of setCurrentTrack + setTimeout + togglePlay pattern
  playTrack: (track) => {
    // First set the track (this resets playbackSource, bufferHealth, etc.)
    get().setCurrentTrack(track);

    // Then immediately set isPlaying = true (no delay needed)
    set({ isPlaying: true });

    // IMMEDIATE HISTORY SAVE: Save track info RIGHT NOW so refresh doesn't lose it
    // This creates an entry with 0 duration that gets updated when track ends/switches
    const current = loadPersistedState();
    const newHistoryItem = {
      trackId: track.trackId || track.id,
      title: track.title,
      artist: track.artist,
      coverUrl: track.coverUrl,
      playedAt: new Date().toISOString(),
      duration: 0, // Will be updated when track ends
      oyeReactions: 0,
    };
    savePersistedState({
      ...current,
      history: [...(current.history || []).slice(-49), newHistoryItem],
    });
    devLog('[VOYO] Track started, saved immediately:', track.title);

    // Update Media Session
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
    }
  },

  // Direct sync from audio element. Skips the toggle logic — used by the
  // native play/pause/ended event listeners in AudioPlayer.tsx so the store
  // always matches what the audio element is actually doing. Idempotent: if
  // the value already matches, no state churn.
  setIsPlaying: (value: boolean) => {
    set((state) => {
      if (state.isPlaying === value) return state;
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        navigator.mediaSession.playbackState = value ? 'playing' : 'paused';
      }
      return { isPlaying: value };
    });
    // Persist intent so a reopen can auto-resume where the user left off.
    try {
      const current = loadPersistedState();
      savePersistedState({ ...current, wasPlaying: value });
    } catch { /* storage blocked */ }
  },

  togglePlay: () => {
    set((state) => {
      const newIsPlaying = !state.isPlaying;

      // FIX: Update Media Session state immediately
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        navigator.mediaSession.playbackState = newIsPlaying ? 'playing' : 'paused';
      }

      return { isPlaying: newIsPlaying };
    });

    // PORTAL SYNC: deferred to idle (same pattern as setCurrentTrack)
    const syncPlay = async () => {
      try {
        const { useUniverseStore } = await import('./universeStore');
        const universeStore = useUniverseStore.getState();
        if (universeStore.isPortalOpen) universeStore.updateNowPlaying();
      } catch {}
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(() => syncPlay(), { timeout: 3000 });
    } else {
      setTimeout(() => syncPlay(), 200);
    }
  },

  setProgress: (progress) => set({ progress }),

  setCurrentTime: (time) => {
    set({ currentTime: time });
    // PERSIST: Save position when crossing each 5-second mark.
    // CRITICAL: dedup by tracking the last persisted second. The previous
    // version's `Math.floor(time) % 5 === 0` was true for time = 5.0,
    // 5.1, ..., 5.9 — at 5-10Hz timeupdate events, that fired the
    // synchronous JSON.parse + JSON.stringify + localStorage.setItem
    // 5-10 times per second when crossing each 5s mark. Main thread block
    // = audio glitch every 5s.
    const flooredSec = Math.floor(time);
    if (time > 0 && flooredSec % 5 === 0 && flooredSec !== _lastPersistedSec) {
      _lastPersistedSec = flooredSec;
      // Defer the persist to idle time. loadPersistedState + JSON.parse +
      // JSON.stringify + localStorage.setItem is synchronous main-thread
      // I/O (~1-5ms). Running it inside setCurrentTime (which fires at 4Hz)
      // was one of the last remaining audio-thread starvation sources.
      const t = time;
      const w = window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
      };
      if (typeof w.requestIdleCallback === 'function') {
        w.requestIdleCallback(() => {
          const current = loadPersistedState();
          savePersistedState({ ...current, currentTime: t });
        }, { timeout: 2000 });
      } else {
        setTimeout(() => {
          const current = loadPersistedState();
          savePersistedState({ ...current, currentTime: t });
        }, 100);
      }
    }

    // PORTAL SYNC: Update now_playing every 10 seconds for live position.
    // Deferred to idle — same pattern as the position persist above.
    if (time > 0 && flooredSec % 10 === 0 && flooredSec !== _lastPortalSyncSec) {
      _lastPortalSyncSec = flooredSec;
      const syncPosition = async () => {
        try {
          const { useUniverseStore } = await import('./universeStore');
          const universeStore = useUniverseStore.getState();
          if (universeStore.isPortalOpen) {
            universeStore.updateNowPlaying();
          }
        } catch {}
      };
      const w2 = window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
      };
      if (typeof w2.requestIdleCallback === 'function') {
        w2.requestIdleCallback(() => syncPosition(), { timeout: 5000 });
      } else {
        setTimeout(() => syncPosition(), 200);
      }
    }
  },

  setDuration: (duration) => set({ duration }),

  seekTo: (time) => set({ seekPosition: time, currentTime: time }),
  clearSeekPosition: () => set({ seekPosition: null }),

  setShouldOpenNowPlaying: (should) => set({ shouldOpenNowPlaying: should }),

  setVolume: (volume) => {
    set({ volume });
    // Debounce persist — slider drag fires dozens of times. Bumped from
    // 200ms → 300ms so a long drag doesn't pay the sync-storage cost on
    // every settle point. localStorage.setItem is ~1-5ms on mobile and
    // blocks the main thread; 300ms lets the drag finish before we write.
    if (_volumePersistTimer) clearTimeout(_volumePersistTimer);
    _volumePersistTimer = setTimeout(() => {
      localStorage.setItem('voyo-volume', String(volume));
      _volumePersistTimer = null;
    }, 300);
  },

  nextTrack: () => {
    const state = get();

    // Handle repeat one mode - replay the same track
    if (state.repeatMode === 'one' && state.currentTrack) {
      trace('nt_repeat_one', state.currentTrack.trackId || state.currentTrack.id, {});
      set({
        isPlaying: true,
        progress: 0,
        currentTime: 0,
        seekPosition: null, // Clear seek position
        // SKEEP FIX: Reset playback rate on track restart
        playbackRate: 1,
        isSkeeping: false,
      });
      return;
    }

    // Signal fanout — every skip/completion feeds OYO in one call.
    // playerStore.nextTrack is the single boundary where this happens, so
    // every surface (Portrait, Landscape, Classic, queue, hotkey, media
    // keys) gets the same consistent signal graph for free.
    //
    // AUDIT-1 #1: Signals MUST fire AFTER set({ currentTrack }) so the
    // AudioPlayer track-change effect sees the new track before play_start
    // telemetry tries to attach. Emitting before set() left oyo.onSkip /
    // oyo.onComplete firing while the OLD track's effect scope was still
    // live → play_start never fired for auto-advanced tracks.
    // Fix: capture signal data now (old track + time still in `state`),
    // then dispatch via queueMicrotask so the signal lands in the next
    // microtask flush — after set() has synchronously updated the store.
    let _pendingSignal: (() => void) | null = null;
    if (state.currentTrack && state.duration > 0) {
      const _track = state.currentTrack;
      const _time = state.currentTime;
      const _completionRate = (_time / state.duration) * 100;
      _pendingSignal = _completionRate < 30
        ? () => oyo.onSkip(_track, _time)
        : () => oyo.onComplete(_track, _completionRate);
    }

    // Check queue first - filter out any unplayable tracks
    if (state.queue.length > 0) {
      // FIX 6: Skip any known unplayable tracks in queue
      // FIX (2026-04-23): ALSO skip the current track. Without this guard,
      // if the queue's head is the same track that's currently playing
      // (duplicate add, repeat-all rebuild race, OYO re-queueing current),
      // nextTrack() "advances" to the same track → feels like the same
      // song plays twice in a row. Discover-fallback already excludes
      // current at line 956-962; this brings queue-pick in line.
      const curId = state.currentTrack?.id;
      const curTrackId = state.currentTrack?.trackId;
      let queueToProcess = state.queue;
      let nextPlayable: QueueItem | null = null;
      let rest: QueueItem[] = [];

      while (queueToProcess.length > 0 && !nextPlayable) {
        const [candidate, ...remaining] = queueToProcess;
        const cid = candidate.track.trackId;
        const candId = candidate.track.id;
        const isSameAsCurrent =
          (curId && (candId === curId || cid === curId)) ||
          (curTrackId && (cid === curTrackId || candId === curTrackId));
        if (cid && (isKnownUnplayable(cid) || isBlocklisted(cid))) {
          devWarn(`[PlayerStore] Skipping unplayable/blocked track in queue: ${candidate.track.title}`);
          queueToProcess = remaining;
        } else if (isSameAsCurrent) {
          devWarn(`[PlayerStore] Skipping same-as-current in queue: ${candidate.track.title}`);
          queueToProcess = remaining;
        } else {
          nextPlayable = candidate;
          rest = remaining;
        }
      }

      // If no playable track found in queue, fall through to other sources
      if (!nextPlayable) {
        trace('nt_queue_all_blocked', state.currentTrack?.trackId || null, { queueLen: state.queue.length });
        devLog('[PlayerStore] No playable tracks in queue, trying other sources...');
        set({ queue: [] }); // Clear the dead queue
      } else {
        trace('nt_queue_pick', nextPlayable.track.trackId || nextPlayable.track.id, {
          pickedTitle: nextPlayable.track.title?.slice(0, 40),
          queueRemaining: rest.length,
        });
        // Always record in history when advancing — even a rapid-skip
        // (currentTime=0 because no timeupdate fired yet) counts as
        // "seen" for exclusion purposes. The old `currentTime > 0` gate
        // let rapid-skipped tracks re-surface in the discover pool
        // seconds later, giving the feel of "same tracks on loop".
        if (state.currentTrack) {
          get().addToHistory(state.currentTrack, state.currentTime);
        }
        // POOL ENGAGEMENT: Record play for next track
        recordPoolEngagement(nextPlayable.track.id, 'play');

        set({
          currentTrack: nextPlayable.track,
          queue: rest,
          isPlaying: true,
          progress: 0,
          currentTime: 0,
          seekPosition: null,
          playbackRate: 1,
          isSkeeping: false,
        });

        // Emit OYO signal AFTER set() — new currentTrack is in store now,
        // so AudioPlayer's track-change effect mounts correctly before any
        // play_start telemetry fires. [AUDIT-1 #1]
        if (_pendingSignal) queueMicrotask(_pendingSignal);

        // PERSIST current track — nextTrack uses set() directly, not
        // setCurrentTrack action. Without this, the track was never saved
        // to localStorage → reload restored the wrong (old) track.
        const trk = nextPlayable.track;
        const cur = loadPersistedState();
        savePersistedState({
          ...cur,
          currentTrackId: trk.id || trk.trackId,
          currentTrackTitle: trk.title,
          currentTrackArtist: trk.artist,
          currentTrackCoverUrl: trk.coverUrl || getThumb(trk.trackId || trk.id),
          currentTime: 0,
        });

        // Persist queue after consuming track. Was setTimeout(100) which
        // fired JSON.stringify + localStorage.setItem right in the window
        // where AudioPlayer is loading the new track src (pause → src swap
        // → load() → decode) — exactly when the main thread must be free
        // for the audio thread to spin up. Now deferred to requestIdleCallback
        // so the persist runs when the browser has idle time, never
        // competing with track-load work. Fallback: setTimeout 500ms if
        // requestIdleCallback isn't available (older Safari).
        const persistQueue = () => {
          const state = get();
          const current = loadPersistedState();
          savePersistedState({
            ...current,
            queue: state.queue.map(q => ({
              trackId: q.track.id,
              title: q.track.title,
              artist: q.track.artist,
              coverUrl: q.track.coverUrl,
              addedAt: q.addedAt,
              source: q.source,
            })),
          });
        };
        const w = window as unknown as {
          requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
        };
        if (typeof w.requestIdleCallback === 'function') {
          w.requestIdleCallback(persistQueue, { timeout: 2000 });
        } else {
          setTimeout(persistQueue, 500);
        }

        return;
      }
    }

    // Queue is empty or all tracks unplayable - check repeat all mode
    if (state.repeatMode === 'all' && state.history.length > 0) {
      // REPEAT ALL FIX: Rebuild queue from history and play first track
      // This ensures proper looping through all played tracks
      if (state.currentTrack && state.currentTime > 0) {
        get().addToHistory(state.currentTrack, state.currentTime);
      }

      // Get all unique tracks from history (in order played)
      const historyTracks = state.history.map(h => h.track);
      const uniqueTracks: Track[] = [];
      const seenIds = new Set<string>();
      for (const track of historyTracks) {
        const trackId = track.id || track.trackId;
        if (trackId && !seenIds.has(trackId)) {
          seenIds.add(trackId);
          uniqueTracks.push(track);
        }
      }

      if (uniqueTracks.length > 0) {
        // Play first track, queue the rest
        const [firstTrack, ...restTracks] = uniqueTracks;
        const newQueue: QueueItem[] = restTracks.map(track => ({
          track,
          addedAt: new Date().toISOString(),
          source: 'auto' as const,
        }));

        trace('nt_repeat_all_rebuild', firstTrack.trackId || firstTrack.id, { historySize: uniqueTracks.length });

        set({
          currentTrack: firstTrack,
          queue: newQueue,
          isPlaying: true,
          progress: 0,
          currentTime: 0,
          seekPosition: null,
          playbackRate: 1,
          isSkeeping: false,
        });
        return;
      }
    }

    // Pick next track - shuffle mode or regular discovery
    // BUILD EXCLUSION SET: Recent history + current track to avoid repeats
    const currentTrackId = state.currentTrack?.id || state.currentTrack?.trackId;
    const recentHistoryIds = new Set<string>();

    // Add last 40 played tracks to exclusion (check both id and trackId).
    // Bumped from 20 → 40: discover pool is ~50 tracks, and 20 left too
    // much re-pick surface when users rapid-skipped — same tracks
    // reappeared within a minute. 40 keeps 10+ fresh candidates.
    state.history.slice(-40).forEach(h => {
      if (h.track?.id) recentHistoryIds.add(h.track.id);
      if (h.track?.trackId) recentHistoryIds.add(h.track.trackId);
    });

    // CRITICAL: Always exclude the current track to prevent immediate replay
    if (currentTrackId) {
      recentHistoryIds.add(currentTrackId);
    }
    if (state.currentTrack?.trackId) {
      recentHistoryIds.add(state.currentTrack.trackId);
    }

    // Filter available tracks to exclude recently played
    const allAvailable = state.discoverTracks.length > 0
      ? state.discoverTracks
      : state.hotTracks.length > 0
      ? state.hotTracks
      : TRACKS;

    // DEDUPLICATION: Remove recently played + collective-blocklist tracks.
    // CRITICAL (2026-04-14): Until now the discover/hot fallback DID NOT
    // apply the blocklist filter — only the queue path did. Result: when
    // the queue emptied and we fell into discover-fallback, we'd land on a
    // blocked track, loadTrack's isBlocked() check would immediately fire
    // nextTrack() again, which would land on ANOTHER blocked track, and we
    // got a 50+ track-per-second cascade visible in telemetry. Fix: filter
    // both layers identically so the fallback never re-surfaces dead IDs.
    let availableTracks = allAvailable.filter(t => {
      if (recentHistoryIds.has(t.id) || recentHistoryIds.has(t.trackId)) return false;
      if (t.trackId && (isKnownUnplayable(t.trackId) || isBlocklisted(t.trackId))) return false;
      return true;
    });

    // Fallback: If all filtered out, drop history exclusion BUT still avoid
    // blocked + current. Shuffle for variety.
    if (availableTracks.length === 0) {
      availableTracks = allAvailable.filter(t => {
        const tid = t.id || t.trackId;
        if (tid === currentTrackId) return false;
        if (t.trackId && (isKnownUnplayable(t.trackId) || isBlocklisted(t.trackId))) return false;
        return true;
      });
      availableTracks = availableTracks.sort(() => Math.random() - 0.5);
    }

    // LAST RESORT: If still empty, use anything except current — even blocked
    // tracks get a shot here (better than nothing). Shuffled.
    if (availableTracks.length === 0) {
      availableTracks = [...allAvailable].filter(t => {
        const tid = t.id || t.trackId;
        return tid !== currentTrackId;
      }).sort(() => Math.random() - 0.5);
    }

    trace('nt_discover_enter', currentTrackId || null, {
      poolSize: allAvailable.length,
      availableAfterFilter: availableTracks.length,
      source: state.discoverTracks.length > 0 ? 'discover' : (state.hotTracks.length > 0 ? 'hot' : 'tracks_fallback'),
      shuffle: state.shuffleMode,
    });

    // POOL REFILL: if history exclusion + filters have eaten ≥50% of the
    // pool, kick a background refresh so the next nextTrack() call sees
    // fresh candidates. Fire-and-forget; today's pick still uses what's
    // left. Only fires when we're pulling from hot/discover (not TRACKS
    // static seed — refreshing doesn't help that path).
    if (
      allAvailable.length > 0 &&
      availableTracks.length <= allAvailable.length / 2 &&
      (state.discoverTracks.length > 0 || state.hotTracks.length > 0)
    ) {
      trace('nt_pool_refill_kick', currentTrackId || null, {
        poolSize: allAvailable.length,
        availableAfterFilter: availableTracks.length,
        filteredPct: Math.round(((allAvailable.length - availableTracks.length) / allAvailable.length) * 100),
      });
      try { get().refreshRecommendations(); } catch {}
    }

    if (availableTracks.length > 0) {
      let nextTrack;

      if (state.shuffleMode) {
        // ROULETTE MODE: Pick random track with animation trigger
        const randomIndex = Math.floor(Math.random() * availableTracks.length);
        nextTrack = availableTracks[randomIndex];
      } else {
        // PRELOAD CONSISTENCY (v194 B1): picks availableTracks[0], matching
        // predictNextTrack. Before: random pick → preload_check hit=False on
        // every transition because preload cached what predict returned (first)
        // but nextTrack picked random. Seen in v193 session: preload_complete
        // fired for Fbd6L9zkuyc but nextTrack landed on sTUg9gjhiI4 instead.
        // Filtering already excludes recent + blocked, so [0] rotates through
        // discover pool as tracks get added to history — no stuck-on-one-track
        // risk.
        nextTrack = availableTracks[0];
      }

      // SAFETY CHECK: Ensure we're not playing the same track
      if ((nextTrack.id === currentTrackId || nextTrack.trackId === currentTrackId) && availableTracks.length > 1) {
        // Pick a different one (deterministically — same reason as above)
        const filtered = availableTracks.filter(t => t.id !== currentTrackId && t.trackId !== currentTrackId);
        if (filtered.length > 0) {
          nextTrack = filtered[0];
        }
      }

      // Same "record every advance" rule as the queue path — rapid
      // skips were the reason identical tracks reappeared in discover.
      if (state.currentTrack) {
        get().addToHistory(state.currentTrack, state.currentTime);
      }
      // POOL ENGAGEMENT: Record play for next track
      recordPoolEngagement(nextTrack.id || nextTrack.trackId, 'play');
      trace('nt_discover_pick', nextTrack.trackId || nextTrack.id, {
        title: nextTrack.title?.slice(0, 40),
        shuffle: state.shuffleMode,
      });
      set({
        currentTrack: nextTrack,
        isPlaying: true,
        progress: 0,
        currentTime: 0,
        seekPosition: null,
        playbackRate: 1,
        isSkeeping: false,
      });

      // Emit OYO signal AFTER set() — discover path. [AUDIT-1 #1]
      if (_pendingSignal) queueMicrotask(_pendingSignal);

      // PERSIST — same fix as queue path above.
      const cur = loadPersistedState();
      savePersistedState({
        ...cur,
        currentTrackId: nextTrack.id || nextTrack.trackId,
        currentTrackTitle: nextTrack.title,
        currentTrackArtist: nextTrack.artist,
        currentTrackCoverUrl: nextTrack.coverUrl || getThumb(nextTrack.trackId || nextTrack.id),
        currentTime: 0,
      });
    } else {
      // WARM-IT-UP SAFETY NET: the pool dried up — every candidate was
      // filtered by history + blocklist + unplayable. No error toast, no
      // retry button. Loop the current track so OYO's flow stays alive,
      // and kick off a pool refresh so the NEXT track-end can advance
      // into fresh content. This is the terminal "OYO never stops"
      // invariant: silence is the bug, looping is the cheap graceful
      // degradation that buys the refresh time to land.
      trace('nt_no_tracks_looping_current', currentTrackId || null, {
        poolSize: allAvailable.length,
        discoverLen: state.discoverTracks.length,
        hotLen: state.hotTracks.length,
      });
      if (state.currentTrack) {
        set({
          isPlaying: true,
          progress: 0,
          currentTime: 0,
          seekPosition: 0,
          playbackRate: 1,
          isSkeeping: false,
        });
      }
      // Async pool refresh — don't await, don't block. On success the
      // next natural track-end finds populated discover/hot pools.
      try { get().refreshRecommendations(); } catch {}
    }
  },

  prevTrack: () => {
    const state = get();

    // SMART PREV: If played >3s, restart current track. Otherwise go to previous.
    if (state.currentTime > 3) {
      // Restart current track
      set({
        isPlaying: true,
        progress: 0,
        currentTime: 0,
        seekPosition: 0, // Seek to start
        // SKEEP FIX: Reset playback rate on track restart
        playbackRate: 1,
        isSkeeping: false,
      });
      return;
    }

    // Go to previous track from history
    if (state.history.length > 0) {
      const lastPlayed = state.history[state.history.length - 1];
      set({
        currentTrack: lastPlayed.track,
        history: state.history.slice(0, -1),
        isPlaying: true,
        progress: 0,
        currentTime: 0,
        seekPosition: null,
        playbackRate: 1,
        isSkeeping: false,
      });

      // PERSIST — same fix as nextTrack paths.
      const trk = lastPlayed.track;
      const cur = loadPersistedState();
      savePersistedState({
        ...cur,
        currentTrackId: trk.id || trk.trackId,
        currentTrackTitle: trk.title,
        currentTrackArtist: trk.artist,
        currentTrackCoverUrl: trk.coverUrl || getThumb(trk.trackId || trk.id),
        currentTime: 0,
      });
    } else {
      // No history - restart current track
      set({
        isPlaying: true,
        progress: 0,
        currentTime: 0,
        seekPosition: 0,
        // SKEEP FIX: Reset playback rate on track restart
        playbackRate: 1,
        isSkeeping: false,
      });
    }
  },

  // PREDICT NEXT TRACK - For preloading (doesn't change state, just returns prediction)
  predictNextTrack: () => {
    const state = get();
    const curId = state.currentTrack?.id;
    const curTrackId = state.currentTrack?.trackId;

    // If queue has items, scan for the first that isn't unplayable AND isn't
    // the currently-playing track. v418 nextTrack also skips same-as-current
    // so predict MUST match or preload will cache the wrong track and the
    // actual advance stalls waiting for the right one to fetch.
    if (state.queue.length > 0) {
      for (const qi of state.queue) {
        const t = qi.track;
        const cid = t.trackId;
        const tid = t.id;
        const isSameAsCurrent =
          (curId && (tid === curId || cid === curId)) ||
          (curTrackId && (cid === curTrackId || tid === curTrackId));
        if (isSameAsCurrent) continue;
        if (cid && (isKnownUnplayable(cid) || isBlocklisted(cid))) continue;
        return t;
      }
      // All queue items are either blocked or same-as-current → fall through
      // to discover pool (matches nextTrack's fallthrough).
    }

    // Otherwise, predict using same logic as nextTrack
    const currentTrackId = curId || curTrackId;
    const recentHistoryIds = new Set<string>();

    // Add last 40 played tracks to exclusion (see note at primary site).
    state.history.slice(-40).forEach(h => {
      if (h.track?.id) recentHistoryIds.add(h.track.id);
      if (h.track?.trackId) recentHistoryIds.add(h.track.trackId);
    });

    // Exclude current track
    if (currentTrackId) recentHistoryIds.add(currentTrackId);
    if (state.currentTrack?.trackId) recentHistoryIds.add(state.currentTrack.trackId);

    // Get available tracks (same priority as nextTrack)
    const allAvailable = state.discoverTracks.length > 0
      ? state.discoverTracks
      : state.hotTracks.length > 0
      ? state.hotTracks
      : TRACKS;

    // v194.1 CONSISTENCY FIX: filter must MATCH nextTrack's filter exactly,
    // otherwise predictNextTrack[0] and nextTrack[0] diverge and preload
    // caches the wrong track. Previously we were missing the blocklist +
    // unplayable checks — v193 telemetry showed the divergence: preload
    // completed for EhyzYPSHRQU, but nextTrack landed on ewt2-_OuFR8
    // because EhyzYPSHRQU was blocklisted and filtered out at play-time.
    let availableTracks = allAvailable.filter(t => {
      if (recentHistoryIds.has(t.id) || recentHistoryIds.has(t.trackId)) return false;
      if (t.trackId && (isKnownUnplayable(t.trackId) || isBlocklisted(t.trackId))) return false;
      return true;
    });

    // Fallback: same pattern as nextTrack — drop history but keep blocklist
    // + unplayable exclusions.
    if (availableTracks.length === 0) {
      availableTracks = allAvailable.filter(t => {
        const tid = t.id || t.trackId;
        if (tid === currentTrackId) return false;
        if (t.trackId && (isKnownUnplayable(t.trackId) || isBlocklisted(t.trackId))) return false;
        return true;
      });
    }

    if (availableTracks.length === 0) {
      return null;
    }

    // Pick [0] — matches nextTrack's non-shuffle pick. Now preload caches
    // the SAME track nextTrack will actually select.
    return availableTracks[0];
  },

  // v214 — predict up to N upcoming tracks for deep preloading.
  // Queue first, then discover-pool fallback. Sequential picks simulate
  // what nextTrack() would actually land on after each advance, so the
  // prefetched blobs line up with what the user really hears.
  predictUpcoming: (n = 2) => {
    const state = get();
    const results: Track[] = [];
    const excluded = new Set<string>();

    // Seed exclusion with history + current track (same as predictNextTrack)
    state.history.slice(-40).forEach(h => {
      if (h.track?.id) excluded.add(h.track.id);
      if (h.track?.trackId) excluded.add(h.track.trackId);
    });
    const currentId = state.currentTrack?.id || state.currentTrack?.trackId;
    if (currentId) excluded.add(currentId);
    if (state.currentTrack?.trackId) excluded.add(state.currentTrack.trackId);

    // Queue is definitive — take as many as we need, skipping dupes/blocked.
    for (const qi of state.queue) {
      if (results.length >= n) break;
      const t = qi.track;
      if (!t?.trackId) continue;
      if (excluded.has(t.trackId) || excluded.has(t.id)) continue;
      if (isKnownUnplayable(t.trackId) || isBlocklisted(t.trackId)) continue;
      results.push(t);
      excluded.add(t.trackId);
      if (t.id) excluded.add(t.id);
    }
    if (results.length >= n) return results;

    // Fill from discover/hot pool with same filter as nextTrack/predictNextTrack.
    const allAvailable = state.discoverTracks.length > 0 ? state.discoverTracks
      : state.hotTracks.length > 0 ? state.hotTracks
      : TRACKS;
    for (const t of allAvailable) {
      if (results.length >= n) break;
      if (!t.trackId) continue;
      if (excluded.has(t.trackId) || excluded.has(t.id)) continue;
      if (isKnownUnplayable(t.trackId) || isBlocklisted(t.trackId)) continue;
      results.push(t);
      excluded.add(t.trackId);
      if (t.id) excluded.add(t.id);
    }

    return results;
  },

  // View Mode Actions
  cycleViewMode: () => {
    const modes: ViewMode[] = ['card', 'lyrics', 'video', 'feed'];
    set((state) => {
      const currentIndex = modes.indexOf(state.viewMode);
      const nextIndex = (currentIndex + 1) % modes.length;
      return { viewMode: modes[nextIndex] };
    });
  },

  setViewMode: (mode) => set({ viewMode: mode }),

  setVideoTarget: (target: 'hidden' | 'portrait' | 'landscape') => set({ videoTarget: target }),
  setVideoPolitePosition: (pos: 'center' | 'bottom' | 'top-right' | 'top-left') => set({ videoPolitePosition: pos }),
  setVideoBlocked: (blocked: boolean) => set({ videoBlocked: blocked }),

  // Queue Actions
  addToQueue: (track, position) => {
    set((state) => {
      // FIX 4: Duplicate detection
      if (state.queue.some(q => q.track.id === track.id)) {
        return state; // Don't add duplicate
      }

      // FIX 5: Reject known unplayable / blocklisted tracks
      if (track.trackId && (isKnownUnplayable(track.trackId) || isBlocklisted(track.trackId))) {
        devWarn(`[PlayerStore] Rejected unplayable/blocked track from queue: ${track.title}`);
        return state; // Don't add unplayable track
      }

      const newItem: QueueItem = {
        track,
        addedAt: new Date().toISOString(),
        source: 'manual',
      };

      // POOL ENGAGEMENT: Record queue action (strong intent signal)
      recordPoolEngagement(track.id, 'queue');

      // VIDEO INTELLIGENCE: Record queue to collective brain
      const trackId = track.trackId || track.id;
      if (trackId) {
        import('../lib/supabase').then(({ videoIntelligenceAPI, isSupabaseConfigured }) => {
          if (!isSupabaseConfigured) return;
          videoIntelligenceAPI.recordQueue(trackId);
        }).catch(() => {});
      }

      // PIPELINE PRE-WARM: adding to queue = declared intent. Fire a
      // priority-7 ensureTrackReady so the extraction worker pool can
      // claim this row WHILE the user keeps queuing more. Worker semantics
      // ("I got it / I'm free / I got it") already run on the VPS side —
      // this makes sure we're actually feeding them work at click time,
      // not play time. p=7 lands above background (p=0) and below
      // user-click-to-play (p=10), so a direct tap still preempts.
      import('../services/voyoStream').then(({ ensureTrackReady }) => {
        void ensureTrackReady(track, null, { priority: 7 });
      }).catch(() => {});

      if (position !== undefined) {
        const newQueue = [...state.queue];
        newQueue.splice(position, 0, newItem);
        return { queue: newQueue };
      }
      return { queue: [...state.queue, newItem] };
    });

    // FIX 3: Persist queue to localStorage
    setTimeout(() => {
      const state = get();
      const current = loadPersistedState();
      savePersistedState({
        ...current,
        queue: state.queue.filter(q => q.track).map(q => ({
          trackId: q.track.id,
          title: q.track.title,
          artist: q.track.artist,
          coverUrl: q.track.coverUrl,
          addedAt: q.addedAt,
          source: q.source,
        })),
      });
    }, 100);

    // CLOUD SYNC: deferred to idle — import() microtask was blocking audio thread
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void };
    const syncQueue = async () => {
      try {
        const { useUniverseStore } = await import('./universeStore');
        if (useUniverseStore.getState().isLoggedIn) useUniverseStore.getState().syncToCloud();
      } catch {}
    };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(() => syncQueue(), { timeout: 5000 });
    else setTimeout(() => syncQueue(), 2000);
  },

  addTracksToQueue: (tracks) => {
    let acceptedTracks: Track[] = [];
    set((state) => {
      const existingIds = new Set(state.queue.map(q => q.track.id));
      const newItems = tracks
        .filter(t => !existingIds.has(t.id) && t.trackId && !isKnownUnplayable(t.trackId) && !isBlocklisted(t.trackId))
        .map(t => ({ track: t, addedAt: new Date().toISOString(), source: 'auto' as const }));
      if (newItems.length === 0) return state;
      acceptedTracks = newItems.map(i => i.track);
      return { queue: [...state.queue, ...newItems] };
    });
    // PIPELINE PRE-WARM: batch-fire ensureTrackReady at p=7 for every
    // accepted track so the worker pool starts claiming them immediately.
    // Same "declared intent" priority tier as single addToQueue.
    if (acceptedTracks.length > 0) {
      import('../services/voyoStream').then(({ ensureTrackReady }) => {
        for (const t of acceptedTracks) {
          void ensureTrackReady(t, null, { priority: 7 });
        }
      }).catch(() => {});
    }
  },

  removeFromQueue: (index) => {
    set((state) => ({
      queue: state.queue.filter((_, i) => i !== index),
    }));

    // FIX 3: Persist queue after removal
    setTimeout(() => {
      const state = get();
      const current = loadPersistedState();
      savePersistedState({
        ...current,
        queue: state.queue.filter(q => q.track).map(q => ({
          trackId: q.track.id,
          title: q.track.title,
          artist: q.track.artist,
          coverUrl: q.track.coverUrl,
          addedAt: q.addedAt,
          source: q.source,
        })),
      });
    }, 100);
  },

  clearQueue: () => {
    set({ queue: [] });

    // FIX 3: Persist empty queue
    setTimeout(() => {
      const current = loadPersistedState();
      savePersistedState({ ...current, queue: [] });
    }, 100);
  },

  reorderQueue: (fromIndex, toIndex) => {
    set((state) => {
      const newQueue = [...state.queue];
      const [removed] = newQueue.splice(fromIndex, 1);
      newQueue.splice(toIndex, 0, removed);
      return { queue: newQueue };
    });

    // FIX 3: Persist queue after reorder
    setTimeout(() => {
      const state = get();
      const current = loadPersistedState();
      savePersistedState({
        ...current,
        queue: state.queue.filter(q => q.track).map(q => ({
          trackId: q.track.id,
          title: q.track.title,
          artist: q.track.artist,
          coverUrl: q.track.coverUrl,
          addedAt: q.addedAt,
          source: q.source,
        })),
      });
    }, 100);
  },

  // History Actions
  addToHistory: (track, duration) => {
    set((state) => ({
      history: [
        ...state.history,
        {
          track,
          playedAt: new Date().toISOString(),
          duration,
          oyeReactions: 0,
        },
      ],
    }));

    // FIXED: Persist FULL track info to localStorage (keep last 50 items)
    // So you NEVER lose a song again
    setTimeout(() => {
      const state = get();
      const current = loadPersistedState();
      savePersistedState({
        ...current,
        history: state.history.slice(-50).filter(h => h.track).map(h => ({
          trackId: h.track.trackId || h.track.id,
          title: h.track.title,
          artist: h.track.artist,
          coverUrl: h.track.coverUrl,
          playedAt: h.playedAt,
          duration: h.duration,
          oyeReactions: h.oyeReactions,
        })),
      });
      devLog('[VOYO] History saved:', state.history.slice(-1)[0]?.track?.title);
    }, 100);

    // CLOUD SYNC: deferred to idle — same pattern as queue sync
    const wh = window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void };
    const syncHistory = async () => {
      try {
        const { useUniverseStore } = await import('./universeStore');
        if (useUniverseStore.getState().isLoggedIn) useUniverseStore.getState().syncToCloud();
      } catch {}
    };
    if (typeof wh.requestIdleCallback === 'function') wh.requestIdleCallback(() => syncHistory(), { timeout: 5000 });
    else setTimeout(() => syncHistory(), 2000);
  },

  // Recommendation Actions
  // ACCUMULATOR MODE: Merge new discoveries, never lose good tracks
  refreshRecommendations: () => {
    const state = get();

    // POOL CONFIG - Keep recommendations alive!
    const MAX_HOT_POOL = 50;      // Was 15 - now accumulates
    const MAX_DISCOVER_POOL = 50; // Was 15 - now accumulates
    const FETCH_SIZE = 20;        // Fetch more each time

    // Exclude currently playing, queued, and recent history
    const excludeIds = new Set([
      state.currentTrack?.id,
      ...state.queue.map((q) => q.track?.id),
      ...state.history.slice(-30).map((h) => h.track?.id),
    ].filter(Boolean) as string[]);

    // VIBES FIRST v5.0: MERGE mode - accumulate, don't replace
    getDatabaseDiscovery().then(async (discovery) => {
      try {
        // Fetch fresh tracks from 324K database
        const [dbHot, dbDiscover] = await Promise.all([
          discovery.getHotTracks(FETCH_SIZE),
          discovery.getDiscoveryTracks(FETCH_SIZE),
        ]);

        if (dbHot.length > 0 || dbDiscover.length > 0) {
          const currentState = get();

          // CONTENT FILTER: Block non-music (news, politics, etc.)
          const NON_MUSIC_KEYWORDS = [
            'news', 'live:', 'breaking', 'trump', 'biden', 'president', 'election',
            'politics', 'political', 'congress', 'senate', 'maga', 'cnn', 'fox news',
            'podcast', 'interview', 'speech', 'documentary', 'lecture', 'sermon',
          ];
          const isMusic = (t: Track) => {
            const combined = `${t.title} ${t.artist || ''}`.toLowerCase();
            return !NON_MUSIC_KEYWORDS.some(kw => combined.includes(kw));
          };

          // Filter existing tracks too (clean up any bad content)
          const cleanExistingHot = currentState.hotTracks.filter(isMusic);
          const cleanExistingDiscover = currentState.discoverTracks.filter(isMusic);

          // MERGE HOT: Existing (cleaned) + New, dedupe, cap at MAX
          const existingHotIds = new Set(cleanExistingHot.map(t => t.id));
          const newHot = dbHot.filter(t => !existingHotIds.has(t.id) && !excludeIds.has(t.id));
          const mergedHotRaw = [...cleanExistingHot, ...newHot];

          // ── OYO DJ BOOST ─────────────────────────────────────────────
          // Promote tracks whose artist matches OYO's learned favourites
          // (populated from user reactions via oyoDJ.onTrackReaction).
          // Stable sort: favourites first, everything else preserves order.
          // No-op for new users (empty favoriteArtists list).
          // This is the architectural North Star: every surface that reads
          // hotTracks now sees content shaped by the OYO DJ brain.
          const oyoInsights = getOyoInsights();
          const favoriteArtists = new Set(
            oyoInsights.favoriteArtists.map(a => a.toLowerCase())
          );
          const mergedHot = favoriteArtists.size === 0
            ? mergedHotRaw.slice(0, MAX_HOT_POOL)
            : [...mergedHotRaw]
                .sort((a, b) => {
                  const aFav = favoriteArtists.has((a.artist ?? '').toLowerCase()) ? 1 : 0;
                  const bFav = favoriteArtists.has((b.artist ?? '').toLowerCase()) ? 1 : 0;
                  return bFav - aFav; // favourites first
                })
                .slice(0, MAX_HOT_POOL);

          // MERGE DISCOVER: Existing (cleaned) + New, dedupe, cap at MAX
          // (Discovery is intentionally NOT OYO-boosted — it's the diversity
          // channel; if OYO already loves it, it belongs in Hot, not here.)
          const existingDiscoverIds = new Set(cleanExistingDiscover.map(t => t.id));
          const newDiscover = dbDiscover.filter(t => !existingDiscoverIds.has(t.id) && !excludeIds.has(t.id));
          const mergedDiscover = [...cleanExistingDiscover, ...newDiscover].slice(0, MAX_DISCOVER_POOL);

          // AI picks from top of discover pool
          const aiPicks = mergedDiscover.slice(0, 5);

          // ── FRESHNESS TIER: 30% of Hot dedicated to trending content ──
          // These are tracks from TRENDING_QUERIES (poolCurator) — recent/viral music.
          // They sit in the front 30% slots regardless of long-term pool score,
          // so Hot always feels current, not just personalized-but-stale.
          const FRESH_SLOTS = Math.ceil(MAX_HOT_POOL * 0.3);
          const trendingTier = getTrendingPoolTracks(FRESH_SLOTS)
            .filter(t => !excludeIds.has(t.id ?? ''));
          const freshIds = new Set(trendingTier.map(t => t.id));
          const finalHot = [
            ...trendingTier,
            ...mergedHot.filter(t => !freshIds.has(t.id)),
          ].slice(0, MAX_HOT_POOL);

          // Gate pool: only R2-cached tracks enter. Filters out trending/
          // hot tracks that haven't been extracted yet. Also hydrates
          // r2KnownStore so pool tracks hit knownInR2Sync=true on tap
          // and go straight to the fast R2 path — no probe needed.
          const { gateToR2 } = await import('../services/r2Gate');
          const [gatedHot, gatedDiscover] = await Promise.all([
            gateToR2(finalHot),
            gateToR2(mergedDiscover),
          ]);

          set({
            hotTracks: gatedHot.length > 0 ? gatedHot : finalHot,
            aiPicks: (gatedDiscover.length > 0 ? gatedDiscover : mergedDiscover).slice(0, 5),
            discoverTracks: gatedDiscover.length > 0 ? gatedDiscover : mergedDiscover,
          });

          // ── POOL PRE-EXTRACTION ───────────────────────────────────────
          // Fire ensureTrackReady at priority 3 (background) for every
          // track in the discover + hot pool. By the time nextTrack()
          // picks from this pool, the worker has had time to extract to R2
          // — eliminating the default iframe path for auto-advance sessions.
          // Priority 3 sits below queue additions (7) and direct plays (10)
          // so it never competes with the user's immediate intent.
          // Spread over 200ms chunks to avoid flooding Supabase with 50
          // parallel RPCs on a single pool refresh.
          import('../services/voyoStream').then(({ ensureTrackReady }) => {
            const poolTracks = [...finalHot, ...mergedDiscover];
            const unique = poolTracks.filter((t, i) =>
              poolTracks.findIndex(x => (x.trackId || x.id) === (t.trackId || t.id)) === i
            );
            unique.forEach((t, i) => {
              setTimeout(() => {
                void ensureTrackReady(t, null, { priority: 3 });
              }, Math.floor(i / 5) * 200); // 5 tracks per 200ms burst
            });
          }).catch(() => {});

          // ── VOYO SPIRIT: STAGE TRACK ON FIRST LOAD ───────────────────
          // Pick the first OYO-sorted hot track and stage it so the player
          // is immediately loaded, artwork visible, ready to go on first
          // tap. We DO NOT flip isPlaying here — browsers block autoplay
          // without a user gesture on the very first visit, and chasing
          // that policy caused a "playing but silent" flash. Compromise
          // per Dash (Apr 2026): seed the track, user taps once, we're in.
          //
          // Guarded by `currentTrack === null` so we never interrupt an
          // existing playback. Fires exactly once on cold start.
          const stateAfterMerge = get();
          if (!stateAfterMerge.currentTrack && mergedHot.length > 0) {
            const seedTrack = mergedHot[0];
            devLog(`[VOYO] 🎵 Stage seed (no autoplay): ${seedTrack.artist} — ${seedTrack.title}`);
            set({
              currentTrack: seedTrack,
              isPlaying: false,
              progress: 0,
              currentTime: 0,
              seekPosition: null,
            });
          }

          const hotAdded = newHot.length;
          const discoverAdded = newDiscover.length;
          if (hotAdded > 0 || discoverAdded > 0) {
            devLog(`[VOYO] 🔥 ACCUMULATED: +${hotAdded} hot (${mergedHot.length} total), +${discoverAdded} discover (${mergedDiscover.length} total)`);
          }
          return;
        }
      } catch (err) {
        devWarn('[VOYO] Database discovery failed, keeping existing pool:', err);
      }
    });

    // Pool fallback: Also merge, don't replace.
    // This is the SYNCHRONOUS path that runs even if databaseDiscovery is
    // slow or fails — it pulls from the in-memory pool curator. Crucially
    // this is also where the autoplay seed needs to fire: if database is
    // slow on first load, the database branch never reaches the seed and
    // the user sees no music. Seed here too as the safety net.
    const poolHot = getPoolAwareHotTracks(10);
    if (poolHot.length > 0) {
      const currentState = get();
      const existingIds = new Set(currentState.hotTracks.map(t => t.id));
      const newPoolHot = poolHot.filter(t => !existingIds.has(t.id));

      if (newPoolHot.length > 0) {
        const merged = [...currentState.hotTracks, ...newPoolHot].slice(0, MAX_HOT_POOL);
        set({ hotTracks: merged });

        // ── VOYO SPIRIT: STAGE SEED SAFETY NET ──
        // If the async database branch hasn't seeded a track yet AND we
        // have hot tracks from the pool fallback, stage now. Same guard
        // as the database branch (currentTrack === null) and same rule:
        // stage only, no isPlaying flip — first-visit browsers block
        // autoplay so we let the user tap play once.
        const stateAfterMerge = get();
        if (!stateAfterMerge.currentTrack && merged.length > 0) {
          const seedTrack = merged[0];
          devLog(`[VOYO] 🎵 Stage seed (pool fallback, no autoplay): ${seedTrack.artist} — ${seedTrack.title}`);
          set({
            currentTrack: seedTrack,
            isPlaying: false,
            progress: 0,
            currentTime: 0,
            seekPosition: null,
          });
        }
      }
    }
  },

  toggleAiMode: () => set((state) => ({ isAiMode: !state.isAiMode })),

  // SMART DISCOVERY: Update discovery based on current track
  // MERGE with existing database results, don't replace
  updateDiscoveryForTrack: (track) => {
    if (!track) return;

    const state = get();
    const excludeIds = [
      track.id,
      ...state.queue.map((q) => q.track?.id),
      ...state.discoverTracks.map((t) => t.id), // Don't duplicate existing
    ].filter(Boolean) as string[];

    // POOL-AWARE v3.0: Pull from dynamic pool (VOYO intelligence learns from user)
    const relatedTracks = getPoolAwareDiscoveryTracks(track, 5, excludeIds);

    // MERGE: Keep database tracks, add pool tracks on top (no replacement)
    // Only add if pool returned meaningful results
    if (relatedTracks.length >= 3) {
      const merged = [...relatedTracks, ...state.discoverTracks];
      // Deduplicate by id
      const seen = new Set<string>();
      const unique = merged.filter(t => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
      set({ discoverTracks: unique.slice(0, 50) }); // Cap at 50 - accumulator mode
    }
    // If pool is sparse, keep existing database tracks
  },

  // Manually refresh discovery for current track
  refreshDiscoveryForCurrent: () => {
    const state = get();
    if (state.currentTrack) {
      get().updateDiscoveryForTrack(state.currentTrack);
    }
  },

  // Mood Actions
  setMood: (mood) => set({ currentMood: mood }),

  // Reaction Actions
  addReaction: (reaction) => {
    const newReaction: Reaction = {
      ...reaction,
      id: `reaction-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
    };
    set((state) => ({
      reactions: [...state.reactions, newReaction],
      oyeScore: state.oyeScore + reaction.multiplier,
    }));

    // Record reaction in preferences (if there's a current track)
    const { currentTrack, duration } = get();
    if (currentTrack) {
      // Import at runtime to avoid circular dependencies
      import('./preferenceStore').then(({ usePreferenceStore }) => {
        usePreferenceStore.getState().recordReaction(currentTrack.id);
      });

      // POOL ENGAGEMENT: Record reaction (strong positive signal) — local
      // pool bookkeeping only. The canonical voyo_signals row (action='react')
      // is written once per OYE gesture by services/oyo/index.ts (onOye →
      // recordRemoteSignal). Previously an inline record_signal('love') RPC
      // fired here too, producing a 3rd taste-graph row per tap (C1 fix).
      recordPoolEngagement(currentTrack.id, 'react');

      // 🔥 OYE = AUTO-BOOST: When user OYEs a track, cache it for offline
      // This is the signature VOYO feature - love it? Keep it forever.
      if (reaction.type === 'oye') {
        import('./downloadStore').then(({ useDownloadStore }) => {
          const { cacheTrack, checkCache } = useDownloadStore.getState();
          // Only cache if not already cached
          checkCache(currentTrack.trackId).then((cached) => {
            if (!cached) {
              devLog(`🔥 [OYE] Auto-boosting: ${currentTrack.title}`);
              cacheTrack(
                currentTrack.trackId,
                currentTrack.title,
                currentTrack.artist,
                Math.floor(duration || 0),
                `https://voyo-edge.dash-webtv.workers.dev/cdn/art/${currentTrack.trackId}?quality=high`
              );
            }
          });
        });
      }
    }

    // Auto-remove after animation (2s)
    setTimeout(() => {
      set((state) => ({
        reactions: state.reactions.filter((r) => r.id !== newReaction.id),
      }));
    }, 2000);
  },

  multiplyReaction: (reactionId) => {
    set((state) => ({
      reactions: state.reactions.map((r) =>
        r.id === reactionId ? { ...r, multiplier: r.multiplier * 2 } : r
      ),
      oyeScore: state.oyeScore + 1,
    }));
  },

  clearReactions: () => set({ reactions: [] }),

  // Roulette Actions
  startRoulette: () => set({ isRouletteMode: true }),

  stopRoulette: (track) => {
    set({ isRouletteMode: false });
    get().setCurrentTrack(track);
  },

  // Playback Mode Actions
  toggleShuffle: () => set((state) => ({ shuffleMode: !state.shuffleMode })),

  cycleRepeat: () => {
    set((state) => {
      const modes: Array<'off' | 'all' | 'one'> = ['off', 'all', 'one'];
      const currentIndex = modes.indexOf(state.repeatMode);
      const nextIndex = (currentIndex + 1) % modes.length;
      return { repeatMode: modes[nextIndex] };
    });
  },

  // SKEEP Actions - Nostalgic CD player fast-forward (chipmunk effect)
  setPlaybackRate: (rate) => set({ playbackRate: rate }),

  startSkeep: () => {
    // Start at 2x, escalate via interval in the UI component
    set({ isSkeeping: true, playbackRate: 2 });
  },

  stopSkeep: () => {
    // Return to normal playback
    set({ isSkeeping: false, playbackRate: 1 });
  },

  // Streaming Optimization Actions
  setNetworkQuality: (quality) => set({ networkQuality: quality }),

  setStreamQuality: (quality) => set({ streamQuality: quality }),

  setBufferHealth: (health, status) => set({
    bufferHealth: Math.max(0, Math.min(100, health)),
    bufferStatus: status
  }),

  setPlaybackSource: (source) => set({ playbackSource: source }),

  setBoostProfile: (profile) => {
    set({ boostProfile: profile });
    try { localStorage.setItem('voyo-boost-profile', profile); } catch {}
  },
  setVoyexSpatial: (value) => {
    const clamped = Math.max(-100, Math.min(100, value));
    set({ voyexSpatial: clamped });
    // Trailing debounce — drop any pending write and schedule a fresh one
    // that captures the LATEST clamped value. The prior leading-throttle
    // (if (!timer) { setTimeout(...) }) saved only the first value of each
    // 500ms window, so the user's final slider position never persisted.
    if (_voyexPersistTimer) clearTimeout(_voyexPersistTimer);
    _voyexPersistTimer = setTimeout(() => {
      try { localStorage.setItem('voyo-voyex-spatial', String(clamped)); } catch {}
      _voyexPersistTimer = null;
    }, 500);
  },
  setOyeBarBehavior: (behavior) => {
    set({ oyeBarBehavior: behavior });
    try { localStorage.setItem('voyo-oye-behavior', behavior); } catch {}
  },
  setOyePrewarm: (enabled) => {
    set({ oyePrewarm: enabled });
    try { localStorage.setItem('voyo-oye-prewarm', String(enabled)); } catch {}
  },

  setPrefetchStatus: (trackId, status) => {
    set((state) => {
      const newMap = new Map(state.prefetchStatus);
      newMap.set(trackId, status);
      return { prefetchStatus: newMap };
    });
  },

  // Detect network quality using Navigator API
  // FIX: Singleton pattern to prevent listener leak
  detectNetworkQuality: (() => {
    let listenerAttached = false;

    return () => {
      const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;

      if (connection) {
        const effectiveType = connection.effectiveType;
        const downlink = connection.downlink; // Mbps

        let quality: NetworkQuality = 'unknown';
        let streamQuality: BitrateLevel = 'high';

        if (effectiveType === '4g' && downlink > 5) {
          quality = 'fast';
          streamQuality = 'high';
        } else if (effectiveType === '4g' || effectiveType === '3g') {
          quality = 'medium';
          streamQuality = 'medium';
        } else if (effectiveType === '2g' || effectiveType === 'slow-2g') {
          quality = 'slow';
          streamQuality = 'low';
        } else if (downlink) {
          // Fallback to downlink speed
          if (downlink > 5) {
            quality = 'fast';
            streamQuality = 'high';
          } else if (downlink > 1) {
            quality = 'medium';
            streamQuality = 'medium';
          } else {
            quality = 'slow';
            streamQuality = 'low';
          }
        }

        set({ networkQuality: quality, streamQuality });

        // Listen for changes - only attach once
        if (!listenerAttached) {
          connection.addEventListener?.('change', () => {
            get().detectNetworkQuality();
          });
          listenerAttached = true;
        }
      } else {
        // No Network Information API - assume fast
        set({ networkQuality: 'fast', streamQuality: 'high' });
      }
    };
  })(),

  // Verse Jam actions
  startJam: (dashId, name) => {
    set({ jammingWith: { dashId, name } });
  },
  endJam: () => {
    set({ jammingWith: null });
  },
}));
