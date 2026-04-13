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
  recordPoolEngagement,
} from '../services/personalization';
import { BitrateLevel, BufferStatus } from '../services/audioEngine';
import { prefetchTrack } from '../services/api';

// VIBES FIRST: Database discovery from 324K tracks (lazy import to avoid circular deps)
let databaseDiscoveryModule: typeof import('../services/databaseDiscovery') | null = null;
async function getDatabaseDiscovery() {
  if (!databaseDiscoveryModule) {
    databaseDiscoveryModule = await import('../services/databaseDiscovery');
  }
  return databaseDiscoveryModule;
}
import { isKnownUnplayable } from '../services/trackVerifier';
import { getInsights as getOyoInsights, onTrackSkip as oyoOnTrackSkip } from '../services/oyoDJ';
import { devLog, devWarn } from '../utils/logger';

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
}

// Load persisted state once at init
const _persistedState = loadPersistedState();

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  // Initial State - restored from localStorage where available
  currentTrack: getPersistedTrack(),
  isPlaying: false,
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
    // Debounce persist — slider drag fires dozens of times. Only write
    // localStorage once the user stops dragging (200ms settle).
    if (_volumePersistTimer) clearTimeout(_volumePersistTimer);
    _volumePersistTimer = setTimeout(() => {
      localStorage.setItem('voyo-volume', String(volume));
      _volumePersistTimer = null;
    }, 200);
  },

  nextTrack: () => {
    const state = get();

    // Handle repeat one mode - replay the same track
    if (state.repeatMode === 'one' && state.currentTrack) {
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

    // POOL ENGAGEMENT: Detect skip vs completion for current track
    if (state.currentTrack && state.duration > 0) {
      const completionRate = (state.currentTime / state.duration) * 100;
      if (completionRate < 30) {
        // User skipped (less than 30% played)
        recordPoolEngagement(state.currentTrack.id, 'skip');
        // OYO DJ learning: feed the skip event so dislikedArtists builds up.
        // Wired here at the playerStore.nextTrack boundary so EVERY surface
        // that triggers a skip (Portrait, Landscape, Classic, queue, hotkey)
        // feeds the brain for free — no per-surface wiring needed.
        oyoOnTrackSkip(state.currentTrack);
      } else {
        // User completed (at least 30% played)
        recordPoolEngagement(state.currentTrack.id, 'complete', { completionRate });
      }
    }

    // Check queue first - filter out any unplayable tracks
    if (state.queue.length > 0) {
      // FIX 6: Skip any known unplayable tracks in queue
      let queueToProcess = state.queue;
      let nextPlayable: QueueItem | null = null;
      let rest: QueueItem[] = [];

      while (queueToProcess.length > 0 && !nextPlayable) {
        const [candidate, ...remaining] = queueToProcess;
        if (candidate.track.trackId && isKnownUnplayable(candidate.track.trackId)) {
          devWarn(`[PlayerStore] Skipping unplayable track in queue: ${candidate.track.title}`);
          queueToProcess = remaining;
        } else {
          nextPlayable = candidate;
          rest = remaining;
        }
      }

      // If no playable track found in queue, fall through to other sources
      if (!nextPlayable) {
        devLog('[PlayerStore] No playable tracks in queue, trying other sources...');
        set({ queue: [] }); // Clear the dead queue
      } else {
        if (state.currentTrack && state.currentTime > 0) {
          get().addToHistory(state.currentTrack, state.currentTime);
        }
        // POOL ENGAGEMENT: Record play for next track
        recordPoolEngagement(nextPlayable.track.id, 'play');

        // INSTANT SKIP: Prefetch the next track in queue for even faster loading
        if (rest.length > 0 && rest[0].track.trackId) {
          prefetchTrack(rest[0].track.trackId);
        }

        set({
          currentTrack: nextPlayable.track,
          queue: rest,
          isPlaying: true,
          progress: 0,
          currentTime: 0,
          seekPosition: null, // Clear seek position
          // SKEEP FIX: Reset playback rate when changing tracks
          playbackRate: 1,
          isSkeeping: false,
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

    // Add last 20 played tracks to exclusion (check both id and trackId)
    state.history.slice(-20).forEach(h => {
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

    // DEDUPLICATION: Remove recently played tracks (check both id and trackId)
    let availableTracks = allAvailable.filter(t =>
      !recentHistoryIds.has(t.id) && !recentHistoryIds.has(t.trackId)
    );

    // Fallback: If all filtered out, use originals BUT still exclude current track
    if (availableTracks.length === 0) {
      availableTracks = allAvailable.filter(t => {
        const tid = t.id || t.trackId;
        return tid !== currentTrackId;
      });
      // Shuffle for variety
      availableTracks = availableTracks.sort(() => Math.random() - 0.5);
    }

    // LAST RESORT: If somehow still empty, use all but shuffle
    if (availableTracks.length === 0) {
      availableTracks = [...allAvailable].sort(() => Math.random() - 0.5);
    }

    if (availableTracks.length > 0) {
      let nextTrack;

      if (state.shuffleMode) {
        // ROULETTE MODE: Pick random track with animation trigger
        const randomIndex = Math.floor(Math.random() * availableTracks.length);
        nextTrack = availableTracks[randomIndex];
      } else {
        // Regular mode: Pick random from available (add variety)
        nextTrack = availableTracks[Math.floor(Math.random() * availableTracks.length)];
      }

      // SAFETY CHECK: Ensure we're not playing the same track
      if ((nextTrack.id === currentTrackId || nextTrack.trackId === currentTrackId) && availableTracks.length > 1) {
        // Pick a different one
        const filtered = availableTracks.filter(t => t.id !== currentTrackId && t.trackId !== currentTrackId);
        if (filtered.length > 0) {
          nextTrack = filtered[Math.floor(Math.random() * filtered.length)];
        }
      }

      if (state.currentTrack && state.currentTime > 0) {
        get().addToHistory(state.currentTrack, state.currentTime);
      }
      // POOL ENGAGEMENT: Record play for next track
      recordPoolEngagement(nextTrack.id || nextTrack.trackId, 'play');
      set({
        currentTrack: nextTrack,
        isPlaying: true,
        progress: 0,
        currentTime: 0,
        seekPosition: null, // Clear seek position
        // SKEEP FIX: Reset playback rate when changing tracks
        playbackRate: 1,
        isSkeeping: false,
      });
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
        seekPosition: null, // Clear seek position
        // SKEEP FIX: Reset playback rate when changing tracks
        playbackRate: 1,
        isSkeeping: false,
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

    // If queue has items, that's definitive
    if (state.queue.length > 0) {
      return state.queue[0].track;
    }

    // Otherwise, predict using same logic as nextTrack
    const currentTrackId = state.currentTrack?.id || state.currentTrack?.trackId;
    const recentHistoryIds = new Set<string>();

    // Add last 20 played tracks to exclusion
    state.history.slice(-20).forEach(h => {
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

    // Filter out recently played
    let availableTracks = allAvailable.filter(t =>
      !recentHistoryIds.has(t.id) && !recentHistoryIds.has(t.trackId)
    );

    if (availableTracks.length === 0) {
      availableTracks = allAvailable.filter(t => {
        const tid = t.id || t.trackId;
        return tid !== currentTrackId;
      });
    }

    if (availableTracks.length === 0) {
      return null;
    }

    // Return first available (predictable for preloading)
    // Note: actual nextTrack uses random, but for preloading we pick first
    // to ensure consistency between predict and actual
    return availableTracks[0];
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

      // FIX 5: Reject known unplayable tracks
      if (track.trackId && isKnownUnplayable(track.trackId)) {
        devWarn(`[PlayerStore] Rejected unplayable track from queue: ${track.title}`);
        return state; // Don't add unplayable track
      }

      const newItem: QueueItem = {
        track,
        addedAt: new Date().toISOString(),
        source: 'manual',
      };

      // INSTANT PLAYBACK: Warm up the track for streaming
      if (track.trackId) {
        prefetchTrack(track.trackId);
      }

      // QUEUE PRE-BOOST: kick off a background cacheTrack for the
      // queued track so it hits R2 before the user reaches it. This
      // means background play will work for queued tracks — the audio
      // element will find the R2 URL on loadTrack instead of falling
      // back to iframe audio (which can't play in background).
      //
      // Deferred 2.5s so it doesn't compete with the currently-playing
      // track's first-buffer bandwidth. Respects downloadSetting ('never'
      // bypasses entirely, 'wifi-only' gates on connection type).
      //
      // Dynamic import to keep downloadStore out of the player-store
      // startup dependency chain.
      if (track.trackId) {
        setTimeout(() => {
          import('./downloadStore').then(({ useDownloadStore }) => {
            const ds = useDownloadStore.getState();
            if (ds.downloadSetting === 'never') return;
            if (ds.downloadSetting === 'wifi-only') {
              const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
              const isWifi = !conn || conn.type === 'wifi' || conn.type === 'ethernet' || !conn.effectiveType?.includes('2g');
              if (!isWifi) return;
            }
            // Don't re-cache if already present (cacheTrack itself no-ops
            // if the track is already in IndexedDB at any quality).
            ds.cacheTrack(
              track.trackId!,
              track.title,
              track.artist,
              track.duration || 0,
              `https://voyo-edge.dash-webtv.workers.dev/cdn/art/${track.trackId}?quality=high`,
            ).catch(() => {});
          }).catch(() => {});
        }, 2500);
      }

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

          set({
            hotTracks: mergedHot,
            aiPicks: aiPicks,
            discoverTracks: mergedDiscover,
          });

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

      // POOL ENGAGEMENT: Record reaction (strong positive signal)
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
    // Debounce spatial persist — slider fires rapidly during drag
    if (!(window as any).__voyexPersistTimer) {
      (window as any).__voyexPersistTimer = setTimeout(() => {
        try { localStorage.setItem('voyo-voyex-spatial', String(clamped)); } catch {}
        (window as any).__voyexPersistTimer = null;
      }, 500);
    }
  },
  setOyeBarBehavior: (behavior) => {
    set({ oyeBarBehavior: behavior });
    try { localStorage.setItem('voyo-oye-behavior', behavior); } catch {}
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
}));
