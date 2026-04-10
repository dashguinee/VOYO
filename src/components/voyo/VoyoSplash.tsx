/**
 * VOYO Boot Loader — single, mature loader for the app
 *
 * Aesthetic: VOYO wordmark + 3 pulsing dots (the simple, mature shell that
 * was the Suspense fallback) + a one-shot boom-expand ring burst at mount
 * (carried over from the old water-drop splash because Dash liked the
 * shape that expands like a boom).
 *
 * Behavior:
 *  - Plays the boom expand animation ONCE at mount (~700ms)
 *  - Initializes the IndexedDB / preference / mediaCache stores in
 *    parallel so the first dictation track is hot-cached
 *  - Resolves only when BOTH the animation timer AND the data prep have
 *    completed — same pattern as the old splash, just dressed down
 *
 * The previous water-drop animation lives in git history (commit 3c2d212^).
 */

import { useState, useEffect, useRef } from 'react';
import { useDownloadStore } from '../../store/downloadStore';
import { usePreferenceStore } from '../../store/preferenceStore';
import { TRACKS } from '../../data/tracks';
import { mediaCache } from '../../services/mediaCache';
import { devLog, devWarn } from '../../utils/logger';

interface VoyoSplashProps {
  onComplete: () => void;
  minDuration?: number;
}

export const VoyoSplash = ({ onComplete, minDuration = 1500 }: VoyoSplashProps) => {
  const [isDataReady, setIsDataReady] = useState(false);
  const [isAnimationDone, setIsAnimationDone] = useState(false);
  const [hidden, setHidden] = useState(false);
  const hasCompletedRef = useRef(false);
  const isDataReadyRef = useRef(false);

  // Store initialization
  const initDownloads = useDownloadStore((s) => s.initialize);
  const preferenceStore = usePreferenceStore(); // Touch to initialize

  // ── Preload: initialise stores + cache real content (invisible work) ──
  useEffect(() => {
    const preloadData = async () => {
      try {
        devLog('🎵 BOOT: initialising stores & caching content...');

        // 1. IndexedDB for cached tracks (3s timeout, fail soft)
        await Promise.race([
          initDownloads(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('IndexedDB timeout')), 3000)),
        ]).catch((err) => {
          devWarn('🎵 BOOT: IndexedDB init failed/timeout, continuing:', err);
        });
        devLog('🎵 BOOT: ✅ IndexedDB ready');

        // 2. Cache first 5 track thumbnails (2s timeout)
        const firstTracks = TRACKS.slice(0, 5);
        const cachePromises = firstTracks.map((track) =>
          mediaCache.cacheTrack(track.trackId, { thumbnail: true }).catch(() => null),
        );
        await Promise.race([
          Promise.all(cachePromises),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
        devLog('🎵 BOOT: ✅ first 5 thumbnails cached');

        // 3. Touch preference store
        devLog(
          '🎵 BOOT: ✅ preferences loaded',
          Object.keys(preferenceStore.trackPreferences).length,
          'tracks',
        );

        // 4. Background pre-cache audio for first track (non-blocking)
        if (firstTracks[0]) {
          mediaCache
            .cacheTrack(firstTracks[0].trackId, { audio: true, thumbnail: true })
            .then(() => devLog('🎵 BOOT: ✅ first track audio pre-cached'))
            .catch(() => {});
        }

        isDataReadyRef.current = true;
        setIsDataReady(true);
      } catch (err) {
        devWarn('🎵 BOOT: init error (continuing anyway):', err);
        isDataReadyRef.current = true;
        setIsDataReady(true);
      }
    };

    preloadData();

    // Safety: force ready after 5 s no matter what
    const safetyTimeout = setTimeout(() => {
      if (!isDataReadyRef.current) {
        devWarn('🎵 BOOT: safety timeout, forcing ready');
        isDataReadyRef.current = true;
        setIsDataReady(true);
      }
    }, 5000);

    return () => clearTimeout(safetyTimeout);
  }, [initDownloads, preferenceStore.trackPreferences]);

  // ── Animation timer ──
  useEffect(() => {
    const t = setTimeout(() => setIsAnimationDone(true), minDuration);
    return () => clearTimeout(t);
  }, [minDuration]);

  // ── Resolve when animation + data both ready ──
  useEffect(() => {
    if (isAnimationDone && isDataReady && !hasCompletedRef.current) {
      hasCompletedRef.current = true;
      // Brief fade-out, then unmount
      setHidden(true);
      const t = setTimeout(() => onComplete(), 220);
      return () => clearTimeout(t);
    }
  }, [isAnimationDone, isDataReady, onComplete]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#050508] overflow-hidden"
      style={{
        opacity: hidden ? 0 : 1,
        transition: 'opacity 220ms ease-out',
        pointerEvents: hidden ? 'none' : 'auto',
        fontFamily: "'Outfit', system-ui, sans-serif",
      }}
    >
      {/* ── Boom expand: rings + particles, one-shot at mount ── */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {/* Splash particles flying outward */}
        {[...Array(8)].map((_, i) => (
          <div
            key={`splash-${i}`}
            className="absolute w-1.5 h-1.5 rounded-full"
            style={{
              background: 'linear-gradient(135deg, #a78bfa, #8b5cf6)',
              boxShadow: '0 0 8px rgba(139, 92, 246, 0.8)',
              transform: `translate(${Math.cos((i * Math.PI * 2) / 8) * 60}px, ${Math.sin((i * Math.PI * 2) / 8) * 60}px)`,
              opacity: 0,
              animation: 'voyo-fade-out 0.7s ease-out forwards',
            }}
          />
        ))}

        {/* Concentric expanding rings — the boom */}
        {[0, 1, 2, 3].map((i) => (
          <div
            key={`ring-${i}`}
            className="absolute rounded-full"
            style={{
              border: `${2 - i * 0.3}px solid rgba(139, 92, 246, ${0.7 - i * 0.15})`,
              boxShadow: `0 0 ${10 - i * 2}px rgba(139, 92, 246, ${0.4 - i * 0.1})`,
              width: 80,
              height: 80,
              opacity: 0,
              animation: `voyo-ring-expand 0.9s ease-out ${i * 0.08}s forwards`,
            }}
          />
        ))}
      </div>

      {/* ── Static shell: VOYO wordmark + 3 pulsing dots ── */}
      <div className="relative z-10 flex flex-col items-center gap-3">
        <span
          className="text-3xl font-black tracking-wider"
          style={{ color: '#8b5cf6', opacity: 0.6 }}
        >
          VOYO
        </span>
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-purple-500/50 animate-pulse"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      </div>

      {/* Local keyframes for the boom — added once at the document level */}
      <style>{`
        @keyframes voyo-ring-expand {
          0%   { transform: scale(0.4); opacity: 0; }
          15%  { opacity: 1; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        @keyframes voyo-fade-out {
          0%   { opacity: 1; transform: translate(0, 0); }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default VoyoSplash;
