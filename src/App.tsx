/**
 * VOYO Music - Main Application
 * The complete music listening experience - YOUR PERSONAL DJ
 *
 * Modes:
 * 1. Classic Mode - Home Feed, Library, Now Playing (Spotify-style)
 * 2. Portrait VOYO - Main player with DJ interaction
 * 3. Landscape VOYO - Wide layout (detected by orientation)
 * 4. Video Mode - Full immersion with floating reactions
 */

import { useState, useEffect, useRef, useCallback, lazy, Suspense, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { User, Search } from 'lucide-react';
import { usePlayerStore } from './store/playerStore';
import { app } from './services/oyo';
import { getYouTubeThumbnail } from './data/tracks';
import { setupMobileAudioUnlock } from './utils/mobileAudioUnlock';
import { AnimatedBackground, BackgroundPicker, BackgroundType, ReactionCanvas } from './components/backgrounds/AnimatedBackgrounds';
import { AudioPlayer } from './components/AudioPlayer';
import { AudioErrorBoundary } from './audio/AudioErrorBoundary';
import { AtmosphereLayer } from './components/atmosphere/AtmosphereLayer';
import { LowBatteryEffect } from './components/atmosphere/LowBatteryEffect';
import { initBatteryMonitor } from './services/battery';
import { YouTubeIframe } from './components/YouTubeIframe';
import { InstallButton } from './components/ui/InstallButton';
import { InstallBanner } from './components/ui/InstallBanner';
import { OfflineIndicator } from './components/ui/OfflineIndicator';
import { DynamicIsland } from './components/ui/DynamicIsland';
import { PushBell } from './components/ui/PushBell';
import { Safe } from './components/ui/Safe';
import { VoyoSplash } from './components/voyo/VoyoSplash';
import { FirstTimeLoader } from './components/voyo/FirstTimeLoader';
import { usePullToRefresh } from './hooks/usePullToRefresh';
import { useIdleDim } from './hooks/useIdleDim';

// Lazy-loaded mode components (code splitting — only load active mode)
const PortraitVOYO = lazy(() => import('./components/voyo/PortraitVOYO'));
const LandscapeVOYO = lazy(() => import('./components/voyo/LandscapeVOYO'));
const VideoMode = lazy(() => import('./components/voyo/VideoMode'));
const ClassicMode = lazy(() => import('./components/classic/ClassicMode'));
const SearchOverlay = lazy(() => import('./components/search/SearchOverlayV2'));
const ArtistPage = lazy(() => import('./components/voyo/ArtistPage'));
const UniversePanel = lazy(() => import('./components/universe/UniversePanel').then(m => ({ default: m.UniversePanel })));
import { useReactionStore } from './store/reactionStore';
import { devLog, devWarn, criticalError } from './utils/logger';
import { AuthProvider } from './providers/AuthProvider';
import { useTabHistory } from './hooks/useTabHistory';

// TRACK POOL: Start pool maintenance for dynamic track management
import { startPoolMaintenance } from './store/trackPoolStore';
import { syncSeedTracks } from './services/centralDJ';
import { TRACKS } from './data/tracks';
import { syncManyToDatabase } from './services/databaseSync';
import { useUniverseStore } from './store/universeStore';
import * as voyoApi from './lib/voyo-api';

// ============================================
// ERROR BOUNDARY — catches render crashes, shows fallback instead of white screen
// ============================================
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// Crash recovery. First crash within the window → silent auto-recover
// (reload the SAME page, warm spinner only, no scary copy). Only if we
// cross CRASH_RESET_THRESHOLD do we escalate to the nuclear nuke-SW-
// and-caches path. Users should never see a technical error page.
const CRASH_WINDOW_MS = 20_000;
const CRASH_RESET_THRESHOLD = 3; // 1+2 soft reloads, then nuke on 3rd
const CRASH_KEY = 'voyo-crash-counter-v1';

function readCrashCounter(): { count: number; firstAt: number } {
  try {
    const raw = sessionStorage.getItem(CRASH_KEY);
    if (!raw) return { count: 0, firstAt: 0 };
    const p = JSON.parse(raw);
    if (Date.now() - (p.firstAt || 0) > CRASH_WINDOW_MS) return { count: 0, firstAt: 0 };
    return p;
  } catch { return { count: 0, firstAt: 0 }; }
}

function bumpCrashCounter(): number {
  try {
    const cur = readCrashCounter();
    const next = {
      count: (cur.count || 0) + 1,
      firstAt: cur.firstAt || Date.now(),
    };
    sessionStorage.setItem(CRASH_KEY, JSON.stringify(next));
    return next.count;
  } catch { return 1; }
}

function clearCrashCounter(): void {
  try { sessionStorage.removeItem(CRASH_KEY); } catch { /* noop */ }
}

// Boot-success marker: flips true on first paint. If the NEXT cold boot
// sees this still unset, something crashed before paint last time.
const BOOT_OK_KEY = 'voyo-boot-ok-v1';
function markBootOk(): void {
  try { sessionStorage.setItem(BOOT_OK_KEY, '1'); } catch { /* noop */ }
}

/**
 * Nuclear reset — unregister SW, delete all caches, reload with a
 * cache-busting query so the HTML isn't served from disk. Used by the
 * error-boundary Reset & Reload button, and auto-fired when the crash
 * counter crosses threshold.
 */
async function nukeAndReload(): Promise<void> {
  clearCrashCounter();
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch { /* noop */ }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      // Preserve voyo-audio-v2 — the SW's activate handler does the same.
      // Nuke was wiping already-played audio on every recovery, forcing
      // expensive re-downloads on the recovery path itself.
      await Promise.all(keys.filter(k => k !== 'voyo-audio-v2').map(k => caches.delete(k)));
    }
  } catch { /* noop */ }
  // Cache-busting query forces a fresh HTML fetch. Slight guard against
  // edge worker/CDN serving a stale response too.
  const bust = Date.now().toString(36);
  const sep = window.location.href.includes('?') ? '&' : '?';
  window.location.replace(`${window.location.href}${sep}v=${bust}`);
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState & { resetting: boolean }> {
  state: ErrorBoundaryState & { resetting: boolean } = { hasError: false, error: null, resetting: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    criticalError('[VOYO] Render crash caught by ErrorBoundary:', error, info.componentStack);
    // ChunkLoadError isn't a real crash — it's a flaky-network symptom.
    // On Guinea / SL LTE, bumping the counter for these would trivially
    // hit the 3-strike threshold and trigger a NUKE that then has to
    // re-download the whole app over the same flaky link. So: classify
    // the error first. For chunk-load errors, try ONE soft reload (no
    // cache wipe, no counter bump). If that also fails we'll land here
    // again and the retry flag will be consumed → bump normally.
    const msg = error?.message || '';
    const isChunkError =
      error?.name === 'ChunkLoadError' ||
      /loading chunk|dynamically imported module|failed to fetch dynamically imported module/i.test(msg);
    if (isChunkError) {
      const RETRY_FLAG = 'voyo-chunk-retry-v1';
      const alreadyRetried = sessionStorage.getItem(RETRY_FLAG) === '1';
      if (!alreadyRetried) {
        try { sessionStorage.setItem(RETRY_FLAG, '1'); } catch {}
        // Soft reload only — preserve caches so the retry uses whatever
        // we already have locally. Small delay lets the error UI paint
        // briefly so the user sees a signal, not a white-flash loop.
        setTimeout(() => { try { window.location.reload(); } catch {} }, 1200);
        void info;
        return;
      }
      // Retried once and still chunk-failing — fall through to normal
      // counter bump. Clear the retry flag so a successful boot later
      // doesn't keep suppressing future bumps on real crashes.
      try { sessionStorage.removeItem(RETRY_FLAG); } catch {}
    }
    // NO auto-reload — auto-reload on crash escalates repeatable crashes into
    // a full lock-out loop (spinner → reload → crash → …). User controls
    // retry via the Reload button. Still bump the counter so a 3rd crash
    // prefers the nuke path on their explicit tap (one-tap escape, not loop).
    bumpCrashCounter();
    void info; // referenced for side-effect logging above
  }

  render() {
    if (this.state.hasError) {
      const crashes = readCrashCounter().count;
      const shouldNuke = crashes >= CRASH_RESET_THRESHOLD;
      return (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(180deg, #0a0a12 0%, #0a0612 50%, #0a0a0f 100%)',
            color: 'white',
            fontFamily: "'Inter', system-ui, sans-serif",
            padding: 24,
            textAlign: 'center',
            gap: 20,
          }}
        >
          <div
            style={{
              fontSize: 44,
              fontWeight: 900,
              letterSpacing: '0.05em',
              background: 'linear-gradient(135deg, #a78bfa, #8b5cf6)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              color: 'transparent',
              filter: 'drop-shadow(0 0 18px rgba(139,92,246,0.35))',
            }}
          >
            VOYO
          </div>
          <div style={{ fontSize: 12, opacity: 0.45, maxWidth: 260, lineHeight: 1.5 }}>
            {shouldNuke
              ? 'Reload with a fresh download — this clears cached data.'
              : 'Hiccup loading. Tap reload to try again.'}
          </div>
          <button
            onClick={() => {
              if (shouldNuke) { void nukeAndReload(); return; }
              try { window.location.reload(); } catch { /* noop */ }
            }}
            style={{
              padding: '12px 28px',
              borderRadius: 999,
              background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
              color: 'white',
              border: 'none',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 0 20px rgba(139, 92, 246, 0.28)',
            }}
          >
            {shouldNuke ? 'Reset & reload' : 'Reload'}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Preflight on every cold boot: if the PREVIOUS session crashed before
// it could mark boot-ok, start fresh with caches nuked. Runs BEFORE
// React mounts so we never enter a render cycle on known-bad state.
(function preflightCrashRecovery() {
  if (typeof window === 'undefined') return;
  try {
    const hadBootOk = sessionStorage.getItem(BOOT_OK_KEY) === '1';
    const crash = readCrashCounter();
    // Immediately clear the boot-ok flag for this session — next cold
    // boot will see it missing if THIS boot crashes before markBootOk.
    sessionStorage.removeItem(BOOT_OK_KEY);
    if (!hadBootOk && crash.count >= CRASH_RESET_THRESHOLD) {
      // Explicit crash loop across sessions. Nuke pre-emptively.
      void nukeAndReload();
    }
  } catch { /* noop */ }
})();

// App modes
type AppMode = 'classic' | 'voyo' | 'video';

// Detect orientation
const useOrientation = () => {
  const [isLandscape, setIsLandscape] = useState(
    typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false
  );

  useEffect(() => {
    const handleResize = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  return isLandscape;
};


// ── Auto-update button (ported from Tivi+) ──
// Two-tier detection:
//  1. SW message — when a new service worker activates with a fresh cache,
//     it postMessages every tab. main.tsx translates that into the
//     `voyo-update-available` window event we listen for here.
//  2. Polled /version.json — every 2 minutes we cache-bust-fetch the
//     version file. If it differs from the build-time stamp, we know a
//     new build is live even if the SW hasn't updated yet. force=true
//     auto-clears all caches and reloads (no user choice).
// Session-storage flag: a force-reload was requested while user was mid-track.
// Consumed on next poll / mount / 'ended' / tab-close-reopen so the update still
// lands, just at a moment that doesn't interrupt listening.
const PENDING_FORCE_RELOAD_KEY = 'voyo-pending-force-reload-v1';
// Timestamp written just before reload — if the app reopens within 10s and the
// version still mismatches (Vercel served stale JS), skip the force-reload
// rather than looping the spinner indefinitely.
const LAST_FORCE_RELOAD_KEY = 'voyo-last-force-reload-ts';

/**
 * Runs the destructive cache-wipe + reload. Extracted so it can be called
 * immediately (safe moment) OR deferred via an 'ended' listener / next poll.
 */
async function performForceReload(): Promise<void> {
  // Guard: if we just reloaded within the last 10s, Vercel likely served stale
  // JS. Don't loop the spinner — let the user use the app and retry next poll.
  const lastTs = parseInt(sessionStorage.getItem(LAST_FORCE_RELOAD_KEY) || '0', 10);
  if (Date.now() - lastTs < 10_000) {
    sessionStorage.removeItem(PENDING_FORCE_RELOAD_KEY);
    sessionStorage.removeItem(LAST_FORCE_RELOAD_KEY);
    return;
  }
  // Clear deferred flag BEFORE reload so a stale-JS bounce doesn't re-trigger.
  sessionStorage.removeItem(PENDING_FORCE_RELOAD_KEY);
  sessionStorage.setItem(LAST_FORCE_RELOAD_KEY, String(Date.now()));

  if (document.pictureInPictureElement) {
    try { await document.exitPictureInPicture(); } catch {}
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    // Preserve voyo-audio-v2 — the SW's own activate handler does the same.
    // Wiping it forces users to re-download already-played audio on every
    // version bump (bandwidth-expensive in Guinea / SL).
    await Promise.all(keys.filter(k => k !== 'voyo-audio-v2').map(k => caches.delete(k)));
  }
  window.location.reload();
}

/** Returns true if it's safe to reload right now (not mid-track). */
function isSafeToReload(): boolean {
  try {
    const { isPlaying, currentTrack, currentTime, duration } = usePlayerStore.getState();
    if (!isPlaying || !currentTrack) return true;
    if (duration <= 0) return true; // no duration known → assume safe
    const remaining = duration - currentTime;
    return remaining <= 10; // <10s left is close enough to "just finish"
  } catch { return true; }
}

function UpdateButton() {
  const [available, setAvailable] = useState(false);
  const [forceUpdate, setForceUpdate] = useState(false);

  useEffect(() => {
    const swHandler = () => setAvailable(true);
    window.addEventListener('voyo-update-available', swHandler);

    let active = true;
    let endedListenerAttached = false;

    // One-shot 'ended' listener on the global <audio> element. Fires when the
    // current track finishes naturally, at which point we perform the deferred
    // force-reload. Kept alive across track boundaries only if the reload is
    // still pending.
    const attachEndedListener = () => {
      if (endedListenerAttached) return;
      const audioEl = document.querySelector('audio');
      if (!audioEl) return;
      endedListenerAttached = true;
      const onEnded = () => {
        audioEl.removeEventListener('ended', onEnded);
        endedListenerAttached = false;
        if (sessionStorage.getItem(PENDING_FORCE_RELOAD_KEY) === '1') {
          void performForceReload();
        }
      };
      audioEl.addEventListener('ended', onEnded);
    };

    async function checkVersion() {
      // If a reload was previously deferred, re-evaluate: user may have paused /
      // finished the track / closed-reopened the tab. Do this BEFORE fetching
      // version.json so we don't even need a network round-trip.
      if (sessionStorage.getItem(PENDING_FORCE_RELOAD_KEY) === '1') {
        if (isSafeToReload()) {
          setForceUpdate(true);
          void performForceReload();
          return;
        }
        attachEndedListener();
      }

      try {
        const res = await fetch('/version.json?t=' + Date.now(), {
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.version && data.version !== __APP_VERSION__) {
          if (data.force) {
            if (isSafeToReload()) {
              setForceUpdate(true);
              await performForceReload();
            } else {
              // DEFER — user is mid-track with >10s left. Persist so we still
              // reload if the tab closes + reopens before the track ends.
              try { sessionStorage.setItem(PENDING_FORCE_RELOAD_KEY, '1'); } catch {}
              attachEndedListener();
            }
          } else {
            setAvailable(true);
          }
        }
      } catch { /* offline or timeout — skip */ }
    }

    checkVersion();
    const interval = setInterval(() => { if (active) checkVersion(); }, 2 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener('voyo-update-available', swHandler);
    };
  }, []);

  if (forceUpdate) {
    return (
      <div className="fixed inset-0 z-[9999] bg-[#050508] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-lg font-bold text-white mb-2" style={{ fontFamily: "'Satoshi', sans-serif" }}>Updating VOYO</h1>
          <div className="w-10 h-[2px] mx-auto rounded-full overflow-hidden bg-white/5">
            <div className="h-full w-full rounded-full" style={{ background: 'rgba(139, 92, 246, 0.5)', animation: 'voyo-loading-bar 1.5s ease-in-out infinite' }} />
          </div>
        </div>
        <style>{`@keyframes voyo-loading-bar { 0%, 100% { transform: translateX(-100%); } 50% { transform: translateX(100%); } }`}</style>
      </div>
    );
  }

  if (!available) return null;

  return (
    <button
      onClick={async () => {
        // Shares the audio-cache-preserving reload helper with the
        // auto force-update path. User tapped so no playback guard.
        await performForceReload();
      }}
      className="fixed bottom-24 right-4 z-[9998] flex items-center gap-2 px-4 py-2.5 rounded-full backdrop-blur-md transition-all duration-300"
      style={{
        background: 'rgba(139, 92, 246, 0.15)',
        border: '1px solid rgba(139, 92, 246, 0.35)',
        boxShadow: '0 10px 30px rgba(139, 92, 246, 0.25)',
        fontFamily: "'Satoshi', sans-serif",
      }}
    >
      <span className="w-2 h-2 rounded-full animate-ping" style={{ background: '#a78bfa' }} />
      <span className="text-xs font-semibold tracking-wide" style={{ color: '#a78bfa' }}>Update available</span>
    </button>
  );
}

function App() {
  // Battery fix: fine-grained selectors
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const setVoyoTab = usePlayerStore(s => s.setVoyoTab);
  const voyoActiveTab = usePlayerStore(s => s.voyoActiveTab);

  // On the feed surface the App header competes with the video for
  // attention (and shows the dark app-root behind its transparent fill,
  // reading as a black strip). Dismiss it after 7s of dwell — smooth
  // opacity + slight upward slide, pointer-events cut so hit area goes
  // with it. Resets on any tab change, so re-entering feed repeats the
  // brief visibility window.
  const [feedHeaderHidden, setFeedHeaderHidden] = useState(false);
  useEffect(() => {
    if (voyoActiveTab !== 'feed') { setFeedHeaderHidden(false); return; }
    const t = setTimeout(() => setFeedHeaderHidden(true), 7000);
    return () => clearTimeout(t);
  }, [voyoActiveTab]);
  const [bgError, setBgError] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [artistPageName, setArtistPageName] = useState<string | null>(null);
  // VOYO PLAYER FIRST - Default to player, but remember user preference
  const [appMode, setAppMode] = useState<AppMode>(() => {
    // One-time migration: reset to voyo player as new default (v1.2)
    const migrated = localStorage.getItem('voyo-mode-migrated-v12');
    if (!migrated) {
      localStorage.removeItem('voyo-app-mode');
      localStorage.setItem('voyo-mode-migrated-v12', 'true');
      return 'voyo';
    }
    const saved = localStorage.getItem('voyo-app-mode');
    return (saved === 'classic' || saved === 'voyo' || saved === 'video')
      ? (saved as AppMode)
      : 'voyo';
  });
  const [backgroundType, setBackgroundType] = useState<BackgroundType>('none'); // Clean dark - users discover effects via toggle
  const [isBackgroundPickerOpen, setIsBackgroundPickerOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const isLandscape = useOrientation();

  // SPLASH SCREEN - Show on first load only (per session)
  const [showSplash, setShowSplash] = useState(() => {
    // Check if splash was already shown this session (v3 = fixed design)
    const splashShown = sessionStorage.getItem('voyo-splash-v3');
    return !splashShown;
  });

  const handleSplashComplete = useCallback(() => {
    sessionStorage.setItem('voyo-splash-v3', 'true');
    setShowSplash(false);
  }, []);

  // Pull-to-refresh: pull down at the top of any view to reload the app.
  // Especially useful while iterating on production fixes — the user can
  // grab a new build without hunting for a refresh button.
  const ptr = usePullToRefresh(appMode !== 'classic');

  // Mark this boot as successful — lets the next cold-boot's preflight
  // know we survived to paint. Also clears any crash counter since a
  // survived render means we're not in a crash loop anymore.
  useEffect(() => {
    markBootOk();
    clearCrashCounter();
    // Successful boot — clear the chunk-retry flag so a future transient
    // chunk-load error gets a fresh single-retry budget.
    try { sessionStorage.removeItem('voyo-chunk-retry-v1'); } catch {}
  }, []);

  // MOBILE FIX: Setup audio unlock on app mount
  useEffect(() => {
    setupMobileAudioUnlock();
    // Battery monitor — correlates BG audio failures with power state.
    // Chrome Android throttles BG tabs much harder under Power Save mode;
    // if our heartbeats still aren't enough, this tells us it's the OS
    // not our code. Also powers the future LowBatteryEffect visual.
    initBatteryMonitor().catch(() => {});
  }, []);

  // DASH AUTH: Handle callback from Command Center (simple, synchronous)
  useEffect(() => {
    const { handleDashCallback } = useUniverseStore.getState();
    const success = handleDashCallback();
    if (success) {
      devLog('[VOYO] DASH sign-in successful!');
      // Trigger re-render for components listening to storage
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'dash_citizen_storage',
      }));
    }
  }, []);

  // VOYO:PLAYTRACK - Listen for track play events from cross-promo sections
  useEffect(() => {
    const handlePlayTrack = async (event: CustomEvent) => {
      const { youtubeId, title, artist, thumbnail } = event.detail;
      if (!youtubeId) return;

      // Create a track object from the event data
      const track = {
        id: `voyo-${youtubeId}`,
        trackId: youtubeId,
        title: title || 'Unknown Track',
        artist: artist || 'Unknown Artist',
        coverUrl: thumbnail || `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
        mood: 'vibe' as const,
        tags: ['cross-promo'],
        oyeScore: 0,
      };

      // Route through app.playTrack → registers with lanes at p=10
      devLog('[VOYO] Playing cross-promo track:', title);
      app.playTrack(track as any, 'unknown');
    };

    const listener = (e: Event) => { handlePlayTrack(e as CustomEvent); };
    window.addEventListener('voyo:playTrack', listener);
    return () => {
      window.removeEventListener('voyo:playTrack', listener);
    };
  }, []);

  // NETWORK DETECTION: Detect network quality on app mount
  useEffect(() => {
    const { detectNetworkQuality } = usePlayerStore.getState();
    detectNetworkQuality();
  }, []);



  // FIRST-TIME EXPERIENCE: Prime the player with a curated track on cold boot.
  // DEFERRED to after first paint so it doesn't block the splash + cold boot
  // doesn't fight the audio loading flow. The player just shows empty for
  // ~500ms longer if it was going to be empty anyway — invisible to users
  // who already have a saved track.
  useEffect(() => {
    const tid = setTimeout(() => {
      const { currentTrack, queue, setIsPlaying } = usePlayerStore.getState();
      if (!currentTrack && queue.length === 0) {
        // Pick a random primer from the top oyeScore tracks instead of
        // hardcoding Calm Down every boot. "Slight random often falls
        // good" — top 15 by score keeps quality high while breaking the
        // one-track monotony on cold boots.
        const topPicks = [...TRACKS]
          .filter(t => (t.oyeScore || 0) >= 50_000_000)
          .sort((a, b) => (b.oyeScore || 0) - (a.oyeScore || 0))
          .slice(0, 15);
        const primer = topPicks.length > 0
          ? topPicks[Math.floor(Math.random() * topPicks.length)]
          : TRACKS[0];
        if (primer) {
          // Primer isn't a user click — use store.setCurrentTrack to prime without
          // registering at p=10 (this is a boot-time placeholder, not an upload request).
          usePlayerStore.getState().setCurrentTrack(primer);
          setIsPlaying(false);
          devLog('[VOYO] First-time primer: loaded', primer.title, '(deferred)');
        }
      }
    }, 800);
    return () => clearTimeout(tid);
  }, []);

  // TRACK POOL MAINTENANCE + sync work — DEFERRED to idle so it doesn't
  // race the first track load. Was causing startup audio muffling because
  // ~5 things were running synchronously on mount: pool maintenance start,
  // 2x Supabase batch syncs, refreshRecommendations (324K DB query), all
  // competing with the first track's audio loading + decoding.
  useEffect(() => {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const scheduleIdle = (cb: () => void): number => {
      if (typeof w.requestIdleCallback === 'function') {
        return w.requestIdleCallback(cb, { timeout: 5000 });
      }
      return window.setTimeout(cb, 2000) as unknown as number;
    };
    const cancelIdle = (id: number) => {
      if (typeof w.cancelIdleCallback === 'function') {
        w.cancelIdleCallback(id);
      } else {
        window.clearTimeout(id);
      }
    };

    // FIRST: OYO builds the session plan — owns HOT + DISCOVER pools from now on.
    import('./services/oyoPlan').then(({ initPlan }) => initPlan()).catch(() => {});
    devLog('[VOYO] VIBES FIRST: OYO plan engine initialising...');

    // SECOND: pool maintenance on idle, seed syncs hard-delayed 12s.
    // Seed syncs were inside scheduleIdle which fires as soon as CPU is free —
    // often within 100ms of mount, racing initPlan() + reactions + moments and
    // saturating the Supabase HTTP/2 connection (ERR_HTTP2_SERVER_REFUSED_STREAM).
    // Audio must be established before any DB write work starts.
    const idleId = scheduleIdle(() => {
      startPoolMaintenance();
      devLog('[VOYO] Track pool maintenance started (deferred)');
    });

    const seedTimer = setTimeout(() => {
      syncSeedTracks(TRACKS).then(count => {
        if (count > 0) devLog(`[VOYO] 🌱 Synced ${count} seed tracks to Supabase`);
      });
      syncManyToDatabase(TRACKS).then(count => {
        if (count > 0) devLog(`[VOYO] 🧠 Synced ${count} seed tracks to video_intelligence`);
      });
    }, 12_000);

    return () => { cancelIdle(idleId); clearTimeout(seedTimer); };
  }, []);

  // REALTIME NOTIFICATIONS: Subscribe to Supabase events for DynamicIsland.
  // DEFERRED via requestIdleCallback so the WebSocket setup + Supabase
  // realtime channel join doesn't race the first track load. Was firing on
  // mount alongside ~10 other things, contributing to startup audio
  // muffling. The user doesn't need realtime notifications in the first
  // few seconds — they're just landing on the app.
  useEffect(() => {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const scheduleIdle = (cb: () => void): number => {
      if (typeof w.requestIdleCallback === 'function') {
        return w.requestIdleCallback(cb, { timeout: 8000 });
      }
      return window.setTimeout(cb, 3000) as unknown as number;
    };
    let teardown: (() => void) | null = null;
    const idleId = scheduleIdle(() => {
      teardown = setupRealtimeNotifications();
    });
    return () => {
      if (typeof w.cancelIdleCallback === 'function') {
        w.cancelIdleCallback(idleId);
      } else {
        window.clearTimeout(idleId);
      }
      teardown?.();
    };
  }, []);

  // Original setup, extracted for the deferred wrapper above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setupRealtimeNotifications = useCallback((): (() => void) => {
    const { subscribeToReactions, unsubscribeFromReactions } = useReactionStore.getState();

    // Get current DASH ID from localStorage (Command Center auth)
    const getDashId = () => {
      try {
        const stored = localStorage.getItem('dash_citizen_storage');
        if (stored) {
          const parsed = JSON.parse(stored);
          // Handle nested format { state: { citizen: { coreId } } }
          return parsed.state?.citizen?.coreId || parsed.coreId || null;
        }
      } catch { /* ignore */ }
      return null;
    };

    const currentDashId = getDashId();

    // Subscribe to reactions realtime
    subscribeToReactions();

    // Listen for new reactions via store updates
    const unsubReactions = useReactionStore.subscribe((state, prevState) => {
      // Check if new reactions arrived
      if (state.recentReactions.length > prevState.recentReactions.length) {
        const newReaction = state.recentReactions[0];

        // Only notify if reaction is from someone else
        if (newReaction.username !== currentDashId) {
          // Determine notification based on reaction context
          const currentTrack = usePlayerStore.getState().currentTrack;

          // If someone reacted to the track you're currently playing
          if (currentTrack && newReaction.track_id === (currentTrack.trackId || currentTrack.id)) {
            const notifType: 'music' | 'message' | 'system' =
              newReaction.reaction_type === 'fire' ? 'music' :
              newReaction.reaction_type === 'oye' ? 'message' : 'music';

            window.pushNotification?.({
              id: `reaction-${newReaction.id}`,
              type: notifType,
              title: newReaction.username,
              subtitle: `${newReaction.emoji} ${newReaction.reaction_type} on ${newReaction.track_title}`
            });
          }
        }
      }

      // Category pulse notifications (when categories get hot)
      Object.entries(state.categoryPulse).forEach(([category, pulse]) => {
        const prevPulse = prevState.categoryPulse[category as keyof typeof prevState.categoryPulse];

        // Notify when category becomes hot
        if (pulse.isHot && !prevPulse.isHot && pulse.count > 5) {
          window.pushNotification?.({
            id: `pulse-${category}-${Date.now()}`,
            type: 'music',
            title: 'MixBoard',
            subtitle: `${category} is heating up`
          });
        }
      });
    });

    // Subscribe to incoming DMs for DynamicIsland notifications
    let dmUnsubscribe: (() => void) | null = null;
    const setupDMSubscription = async () => {
      try {
        // Static import — voyo-api is already in the main chunk via other static
        // importers (Hub.tsx, ProfilePage.tsx, etc.), so a dynamic import here
        // just triggered a Vite "static and dynamic import" warning without
        // actually splitting anything off.
        const { messagesAPI, isConfigured } = voyoApi;
        if (!isConfigured) return;

        const dashId = getDashId();
        if (!dashId) return;

        // Subscribe returns an unsubscribe function
        dmUnsubscribe = messagesAPI.subscribeToIncoming(dashId, (newMessage) => {
          // Push to DynamicIsland
          window.pushNotification?.({
            id: `dm-${newMessage.id}`,
            type: 'message',
            title: newMessage.from_id,
            subtitle: newMessage.message.slice(0, 50) + (newMessage.message.length > 50 ? '...' : '')
          });
        });
        devLog('📬 [DM] Subscription setup complete');
      } catch (err) {
        devWarn('📬 [DM] Subscription setup failed:', err);
      }
    };
    setupDMSubscription();

    return () => {
      unsubscribeFromReactions();
      unsubReactions();
      if (dmUnsubscribe) {
        dmUnsubscribe();
      }
    };
  }, []);

  // PERSIST APP MODE: Save to localStorage when it changes
  useEffect(() => {
    try { localStorage.setItem('voyo-app-mode', appMode); } catch {}
  }, [appMode]);

  // Back gesture peels the app-mode stack: Video → VOYO → Classic.
  // Keeps the user inside the app across every mode flip instead of
  // exiting on the first back press. Works alongside the voyo-tab
  // stack inside PortraitVOYO (modals peel first, then voyo-tab,
  // then app-mode, then the real exit).
  useTabHistory(appMode, setAppMode, 'app-mode');

  // Ambient idle dim — disabled during video mode (video already creates mood)
  const { dimLevel } = useIdleDim({ disabled: appMode === 'video' });

  // Get background image URL with fallback
  const getBackgroundUrl = () => {
    if (!currentTrack) return '';
    if (bgError) {
      return getYouTubeThumbnail(currentTrack.trackId, 'high');
    }
    return currentTrack.coverUrl;
  };

  // Handle video mode entry/exit (legacy appMode route, used by VOYO + Landscape)
  const handleVideoModeEnter = () => setAppMode('video');
  const handleVideoModeExit = () => setAppMode('voyo');

  // Search-triggered video: use the existing 'portrait' target — a
  // 208×208 floating mini-player rendered by the global YouTubeIframe.
  // Search stays on top of (or alongside) a draggable mini video, no
  // new component, no custom overlay, no gestures eaten.
  const openVideoOverlay = useCallback(() => {
    usePlayerStore.getState().setVideoTarget('portrait');
  }, []);
  // Restore hidden on search close so the mini iframe doesn't linger.
  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    const vt = usePlayerStore.getState().videoTarget;
    if (vt === 'portrait' || vt === 'landscape') {
      usePlayerStore.getState().setVideoTarget('hidden');
    }
  }, []);

  // Compact the floating portrait player when Search is active — it
  // shrinks ~15% via transform scale so the search pane has more room
  // without unmounting the iframe (zero reload, smooth spring transition).
  useEffect(() => {
    usePlayerStore.getState().setPlayerCompact(isSearchOpen);
  }, [isSearchOpen]);

  // PWA back-gesture handler. Push a history entry when search opens;
  // the system back button / Android gesture pops it → we close search
  // instead of exiting the app. Ignored if search is closed via the X
  // (we pop our own entry so back-stack stays clean).
  useEffect(() => {
    if (!isSearchOpen) return;
    const marker = `voyo-search-${Date.now()}`;
    window.history.pushState({ voyoModal: marker }, '');
    let closedFromPop = false;
    const onPop = () => {
      closedFromPop = true;
      setIsSearchOpen(false);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // If search closed via UI (X, ESC) — pop the entry we pushed so
      // the back-stack doesn't carry a dead marker.
      if (!closedFromPop && window.history.state?.voyoModal === marker) {
        window.history.back();
      }
    };
  }, [isSearchOpen]);

  // Handle mode switching
  const handleSwitchToVOYO = (tab?: 'music' | 'feed' | 'upload' | 'dahub') => {
    // DEFENSIVE: onClick handlers pass the MouseEvent as the first arg which
    // would otherwise set voyoActiveTab to an event object. Only accept strings.
    const VALID_TABS = ['music', 'feed', 'upload', 'dahub'] as const;
    const validTab = (typeof tab === 'string' && (VALID_TABS as readonly string[]).includes(tab))
      ? tab as typeof VALID_TABS[number]
      : 'music';
    setVoyoTab(validTab);
    setAppMode('voyo');
  };
  const handleSwitchToClassic = () => setAppMode('classic');

  return (
    <AppErrorBoundary>
    <AuthProvider>
    {/* First-time overlay — captures name + unlocks audio gesture, then
        fades. Renders null for returning users (localStorage gate). Sits
        OUTSIDE Suspense so it paints immediately while lazy chunks + SW
        precache warm up underneath. */}
    <FirstTimeLoader />
    {/*
      Suspense fallback shares the same VOYO wordmark + 3-dots aesthetic as
      the BootLoader (formerly VoyoSplash) so the user sees ONE continuous
      loader. The fallback is the static shell — VoyoSplash mounts on top
      with the boom-expand burst + the actual data preload. Visually they
      stitch into a single screen.
    */}
    <Suspense fallback={
      <div className="h-full w-full bg-[#050508] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="text-3xl font-black tracking-wider" style={{ color: '#8b5cf6', opacity: 0.6 }}>VOYO</span>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-1.5 h-1.5 rounded-full bg-purple-500/50 animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </div>
        </div>
      </div>
    }>
    <div className="relative h-full w-full bg-[#050508] overflow-hidden">
      {/* VOYO Boot Loader — VOYO wordmark + 3 dots + boom-expand ring burst.
          minDuration is 900ms — just enough to see the boom rings expand once
          + the 220ms fade-out. Faster perceived boot, less standing around. */}
      {showSplash && (
        <VoyoSplash onComplete={handleSplashComplete} minDuration={900} />
      )}

      {/* Auto-update banner (Tivi+ pattern) */}
      <UpdateButton />

      {/* Pull-to-refresh indicator (Tivi+ pattern) — fades in as you pull
          down at the top of any view, rotates with the pull distance, fires
          window.location.reload() once threshold is crossed. */}
      {ptr.pulling && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[9998] flex items-center justify-center transition-opacity duration-200"
          style={{
            top: Math.max(0, ptr.pullY - 20),
            opacity: ptr.pullY > 20 ? Math.min(1, ptr.pullY / 60) : 0,
          }}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-md"
            style={{
              background: ptr.refreshing ? 'rgba(139, 92, 246, 0.2)' : 'rgba(0, 0, 0, 0.6)',
              border: `1.5px solid ${ptr.pullY > 40 ? 'rgba(139, 92, 246, 0.55)' : 'rgba(255, 255, 255, 0.18)'}`,
              transform: `rotate(${ptr.pullY * 3}deg)`,
              transition: 'background 0.2s, border-color 0.2s',
            }}
          >
            {ptr.refreshing ? (
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-white/60">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            )}
          </div>
        </div>
      )}

      {/* Dynamic Background based on current track (only for VOYO modes) */}
      {appMode !== 'video' && appMode !== 'classic' && (
        <div className="absolute inset-0 z-0">
          {/* Blurred album art background with fallback */}
          {currentTrack && (
            <div
              className="absolute inset-0"
              key={currentTrack.id}
            >
              <img
                src={getBackgroundUrl()}
                alt=""
                loading="lazy"
                decoding="async"
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover blur-3xl opacity-15 scale-110"
                onError={() => setBgError(true)}
              />
            </div>
          )}

          {/* ANIMATED BACKGROUND - User's chosen vibe */}
          <AnimatedBackground type={backgroundType} mood="vibe" />

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0f]/80 via-[#0a0a0f]/50 to-[#0a0a0f]/90" />
        </div>
      )}

      {/* REACTION CANVAS - Reactions float up when tapped */}
      {appMode !== 'video' && appMode !== 'classic' && (
        <ReactionCanvas />
      )}

      {/* Main Content */}
      
        {/* GLOBAL LANDSCAPE OVERRIDE - When landscape, always show video player */}
        {isLandscape && currentTrack ? (
          <LandscapeVOYO onVideoMode={handleVideoModeEnter} />
        ) : appMode === 'classic' ? (
          <div
            key="classic"
            className="relative z-10 h-full"
          >
            <ClassicMode
              onSwitchToVOYO={handleSwitchToVOYO}
              onSearch={() => setIsSearchOpen(true)}
            />
          </div>
        ) : appMode === 'video' ? (
          <div
            key="video"
            className="relative z-10 h-full"
          >
            <VideoMode onExit={handleVideoModeExit} />
          </div>
        ) : (
          <div
            key="voyo"
            className="relative z-10 h-full flex flex-col"
          >
            {/* Top Bar - VOYO Logo & Navigation — fully transparent, ghost buttons.
                On the feed surface it auto-hides 7s after entry — opacity + lift
                AND height/padding collapse together so the dark "strip" of empty
                flex-row goes with it. Both moves run on the same easing so the
                retract reads as one motion. */}
            <header
              className="relative flex items-center justify-between px-4 bg-transparent"
              style={{
                paddingTop: feedHeaderHidden ? 0 : 'max(0.75rem, env(safe-area-inset-top))',
                paddingBottom: feedHeaderHidden ? 0 : '0.75rem',
                maxHeight: feedHeaderHidden ? 0 : '120px',
                overflow: 'hidden',
                opacity: feedHeaderHidden ? 0 : 1,
                transform: feedHeaderHidden ? 'translateY(-8px)' : 'translateY(0)',
                pointerEvents: feedHeaderHidden ? 'none' : 'auto',
                transition: [
                  'opacity 800ms cubic-bezier(0.16, 1, 0.3, 1)',
                  'transform 800ms cubic-bezier(0.16, 1, 0.3, 1)',
                  'max-height 800ms cubic-bezier(0.16, 1, 0.3, 1)',
                  'padding 800ms cubic-bezier(0.16, 1, 0.3, 1)',
                ].join(', '),
              }}
              aria-hidden={feedHeaderHidden}
            >
              {/* Left: VOYO Logo — purple → bronze (brand colors, no pink, no yellow) */}
              <div className="flex items-center">
                <span
                  className="text-2xl font-black tracking-tight"
                  style={{
                    background: 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 50%, #D4A053 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    filter: 'drop-shadow(0 0 12px rgba(139,92,246,0.3))',
                  }}
                >
                  VOYO
                </span>
              </div>

              {/* Center: Dynamic Island Notifications + push opt-in.
                  Both isolated in their own Safe boundary so any
                  rendering hiccup here can't take down the header. */}
              <div className="flex-1 flex justify-center items-center gap-2">
                <Safe name="DynamicIsland"><DynamicIsland /></Safe>
                <PushBell appCode="voyo" />
              </div>

              {/* Right cluster — search is a textured pill (grey→purple fade,
                  inset highlight + lift shadow) that reads as a real button
                  without shouting. Profile is smaller, more faded, with a
                  very soft bronze-ivory ambient dot behind — it reads as
                  the corner glow of a named person, not a glyph.
                  V00 (DashAuthBadge) removed — identity surfaces inside
                  the AccountMenu now, not as a badge. */}
              <div className="flex items-center gap-2.5 pr-1">
                {/* Search — textured pill */}
                <button
                  aria-label="Search"
                  onClick={() => setIsSearchOpen(true)}
                  className="p-2 rounded-full active:scale-95 transition-transform"
                  style={{
                    background: 'linear-gradient(135deg, rgba(180,180,200,0.10) 0%, rgba(139,92,246,0.16) 100%)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    boxShadow: [
                      'inset 0 1px 0 rgba(255,255,255,0.08)',
                      'inset 0 -1px 0 rgba(0,0,0,0.18)',
                      '0 2px 6px rgba(0,0,0,0.25)',
                    ].join(', '),
                  }}
                >
                  <Search className="w-[17px] h-[17px] text-white/75" strokeWidth={2} />
                </button>

                {/* Profile — smaller + faded + ambient bronze-ivory dot */}
                <button
                  className="relative p-1.5 rounded-full active:scale-95 transition-transform"
                  aria-label="Profile"
                  onClick={() => setIsProfileOpen(true)}
                >
                  <span
                    aria-hidden
                    className="absolute inset-[-2px] rounded-full pointer-events-none"
                    style={{
                      background: 'radial-gradient(circle at 50% 50%, rgba(240,220,190,0.18) 0%, rgba(240,220,190,0.05) 45%, transparent 72%)',
                      filter: 'blur(2px)',
                    }}
                  />
                  <User className="relative w-[15px] h-[15px] text-white/45" strokeWidth={1.6} />
                </button>
              </div>
            </header>

            {/* VOYO Mode Content - Portrait or Landscape */}
            <div className="flex-1 overflow-hidden">
              {isLandscape ? (
                <LandscapeVOYO onVideoMode={handleVideoModeEnter} />
              ) : (
                <PortraitVOYO
                  onSearch={() => setIsSearchOpen(true)}
                  onDahub={() => setVoyoTab('dahub')}
                  onHome={handleSwitchToClassic}
                />
              )}
            </div>
          </div>
        )}
      


      {/* Atmosphere — global cozy field (top fade + drifting amber motes +
          subtle vignette). Mounted high in the tree so every screen sits
          inside the firelight wash, not just specific surfaces. */}
      <AtmosphereLayer />
      {/* Low-battery visual — currently a no-op placeholder. Will render
          a subtle candle-flicker / warm-dim state when battery < 20% and
          not charging. Hook is live, visual pending. */}
      <LowBatteryEffect />

      {/* Audio Player — wrapped in error boundary so a throw inside the
          Web Audio chain or any of the 15+ effects doesn't kill the whole
          app. The boundary auto-remounts after 1s for transient failures. */}
      <AudioErrorBoundary>
        <AudioPlayer />
      </AudioErrorBoundary>

      {/* YouTube Iframe - GLOBAL for all modes (Classic needs it for streaming) */}
      <YouTubeIframe />

      {/* Search Overlay — when a result is tapped, openVideoOverlay flips
          videoTarget to 'landscape' so the global iframe renders BEHIND the
          search backdrop (z:40 under search's z:50 + bg-black/80 blur).
          User sees the video blurred in the back, search stays fully
          scrollable and tappable. closeSearch restores videoTarget=hidden. */}
      <SearchOverlay
        isOpen={isSearchOpen}
        onClose={closeSearch}
        // Keep search mounted underneath ArtistPage so back-gesture peels
        // cleanly: artist → search → home. ArtistPage's useBackGuard pushes
        // its own history entry on mount, which gets popped first on back;
        // search's existing back-guard peels second. Previously closeSearch
        // fired synchronously here, tearing down search's back marker before
        // ArtistPage mounted → back from artist escaped the app.
        onArtistTap={(name) => { setArtistPageName(name); }}
        onEnterVideoMode={openVideoOverlay}
      />

      {/* Artist Page Overlay */}
      {artistPageName && (
        <ArtistPage
          artistName={artistPageName}
          onClose={() => setArtistPageName(null)}
          onPlayTrack={(trackId, title, artist) => {
            app.playTrack({
              id: trackId,
              trackId,
              title,
              artist,
              coverUrl: `https://i.ytimg.com/vi/${trackId}/hqdefault.jpg`,
              tags: [],
              oyeScore: 0,
              duration: 0,
              createdAt: new Date().toISOString(),
            }, 'artist');
          }}
        />
      )}

      {/* Background/Vibe Picker - Choose your animated background */}
      <BackgroundPicker
        current={backgroundType}
        onSelect={setBackgroundType}
        isOpen={isBackgroundPickerOpen}
        onClose={() => setIsBackgroundPickerOpen(false)}
      />

      {/* Universe Panel - Full Profile/Settings/Login/Backup */}
      <UniversePanel isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />

      {/* PWA Install — the banner owns the install moment (top card, 8s
          after boot, 10s auto-hide, 14-day dismiss cooldown). The pill
          stays hidden until the banner either dismisses OR declines to
          render (cooldown active / already seen this session) — then it
          takes over as the persistent fallback. Coordinated via
          src/hooks/installSurface.ts so pwa_install_shown fires once. */}
      <InstallButton />
      <InstallBanner />

      {/* Offline Indicator - Shows when network is lost */}
      <OfflineIndicator />

      {/* Ambient idle dim — fades in after inactivity, restores instantly on input */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          pointerEvents: 'none',
          background: '#000',
          opacity: dimLevel === 0 ? 0 : dimLevel === 1 ? 0.25 : 0.5,
          transition: 'opacity 1.8s ease',
          willChange: 'opacity',
        }}
      />
    </div>
    </Suspense>
    </AuthProvider>
    </AppErrorBoundary>
  );
}

export default App;
