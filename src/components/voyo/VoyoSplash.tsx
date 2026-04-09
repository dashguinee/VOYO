/**
 * VOYO Splash Screen - Premium Water Drop Animation
 *
 * USEFUL: Actually preloads stores and data during animation
 * - Initializes download store (IndexedDB)
 * - Preloads first track thumbnail for smoother experience
 * - Initializes preference store
 * - Only completes when BOTH animation AND data are ready
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

export const VoyoSplash = ({ onComplete, minDuration = 2800 }: VoyoSplashProps) => {
  const [phase, setPhase] = useState<'intro' | 'drop' | 'impact' | 'expand' | 'done'>('intro');
  const [isDataReady, setIsDataReady] = useState(false);
  const [isAnimationDone, setIsAnimationDone] = useState(false);
  const hasCompletedRef = useRef(false);
  const isDataReadyRef = useRef(false);

  // Store initialization
  const initDownloads = useDownloadStore((s) => s.initialize);
  const preferenceStore = usePreferenceStore(); // Touch to initialize

  // Preload: Initialize stores AND cache real content
  useEffect(() => {
    const preloadData = async () => {
      try {
        devLog('🎵 SPLASH: Initializing stores & caching content...');

        // 1. Initialize IndexedDB for cached tracks (with timeout)
        await Promise.race([
          initDownloads(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('IndexedDB timeout')), 3000))
        ]).catch(err => {
          devWarn('🎵 SPLASH: IndexedDB init failed/timeout, continuing:', err);
        });
        devLog('🎵 SPLASH: ✅ IndexedDB ready!');

        // 2. Cache first 5 track thumbnails using mediaCache (not just Image preload)
        const firstTracks = TRACKS.slice(0, 5);
        const cachePromises = firstTracks.map(track =>
          mediaCache.cacheTrack(track.trackId, { thumbnail: true }).catch(() => null)
        );
        await Promise.race([
          Promise.all(cachePromises),
          new Promise(resolve => setTimeout(resolve, 2000))
        ]);
        devLog('🎵 SPLASH: ✅ First 5 thumbnails cached!');

        // 3. Skipping Fly.io search warmup - database is source of truth
        // refreshRecommendations() in App.tsx loads from 324K Supabase tracks
        devLog('🎵 SPLASH: ✅ Database is source of truth (no Fly.io warmup)');

        // 4. Touch preference store to ensure it's initialized
        devLog('🎵 SPLASH: ✅ Preferences loaded!', Object.keys(preferenceStore.trackPreferences).length, 'tracks');

        // 5. Pre-cache audio for first track (background, non-blocking)
        if (firstTracks[0]) {
          mediaCache.cacheTrack(firstTracks[0].trackId, { audio: true, thumbnail: true })
            .then(() => devLog('🎵 SPLASH: ✅ First track audio pre-cached!'))
            .catch(() => {});
        }

        isDataReadyRef.current = true;
        setIsDataReady(true);
      } catch (err) {
        devWarn('🎵 SPLASH: Init error (continuing anyway):', err);
        isDataReadyRef.current = true;
        setIsDataReady(true);
      }
    };

    preloadData();

    // SAFETY: Force ready after 5 seconds no matter what
    const safetyTimeout = setTimeout(() => {
      if (!isDataReadyRef.current) {
        devWarn('🎵 SPLASH: Safety timeout triggered, forcing ready');
        isDataReadyRef.current = true;
        setIsDataReady(true);
      }
    }, 5000);

    return () => clearTimeout(safetyTimeout);
  }, [initDownloads, preferenceStore.trackPreferences]);

  // Animation timeline
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    timers.push(setTimeout(() => setPhase('drop'), 500));
    timers.push(setTimeout(() => setPhase('impact'), 1200));
    timers.push(setTimeout(() => setPhase('expand'), 2000));
    timers.push(setTimeout(() => setIsAnimationDone(true), minDuration));

    return () => timers.forEach(clearTimeout);
  }, [minDuration]);

  // Complete only when BOTH animation AND data are ready
  useEffect(() => {
    if (isAnimationDone && isDataReady && !hasCompletedRef.current) {
      hasCompletedRef.current = true;
      setPhase('done');
      onComplete();
    }
  }, [isAnimationDone, isDataReady, onComplete]);

  return (
    <>
      {phase !== 'done' && (
        <div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, #0a0612 0%, #1a0a18 30%, #1a100a 60%, #0a0612 100%)',
          }}
        >
          {/* Ambient particles */}
          <div className="absolute inset-0 overflow-hidden">
            {[...Array(20)].map((_, i) => (
              <div
                key={i}
                className="absolute w-1 h-1 rounded-full bg-orange-400/15"
                style={{
                  left: `${10 + (i * 4.5) % 80}%`,
                  top: `${20 + (i * 7) % 60}%`,
                  animationDelay: `${i * 0.2}s`,
                  animationDuration: `${3 + (i % 3)}s`,
                }}
              />
            ))}
          </div>

          {/* Central glow */}
          <div
            className="absolute w-96 h-96 rounded-full blur-3xl"
            style={{
              background: 'radial-gradient(circle, rgba(249, 115, 22, 0.2) 0%, rgba(139, 92, 246, 0.15) 40%, transparent 70%)',
            }}
          />

          {/* VOYO Logo */}
          <div
            className="relative z-20 mb-8 animate-[voyo-scale-in_0.6s_ease_forwards]"
          >
            {/* Outer ring glow */}
            <div
              className="absolute -inset-8 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(147, 51, 234, 0.2) 0%, transparent 70%)',
              }}
            />

            {/* Logo text */}
            <span
              className="text-6xl font-black tracking-wider relative"
              style={{
                background: 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 50%, #a78bfa 100%)',
                backgroundSize: '200% 200%',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                color: 'transparent',
                filter: 'drop-shadow(0 0 30px rgba(168, 85, 247, 0.5))',
                animation: 'voyo-gradient-shift 3s linear infinite',
              }}
            >
              VOYO
            </span>

            {/* Subtitle */}
            <p
              className="text-center text-xs text-purple-300/50 mt-2 tracking-[0.3em] uppercase"
              style={{
                opacity: phase !== 'intro' ? 0.6 : 0,
                transition: 'opacity 0.5s ease 0.3s',
              }}
            >
              Music
            </p>
          </div>

          {/* Water Drop - Centered */}
          <div className="relative h-40 flex items-start justify-center">
            <>
              {(phase === 'intro' || phase === 'drop') && (
                <div
                  className="relative animate-[voyo-scale-in_0.4s_ease_forwards]"
                  style={phase === 'drop' ? {
                    animation: 'voyo-drop-fall 0.5s ease-in forwards',
                  } : undefined}
                >
                  {/* Drop body */}
                  <div
                    className="w-5 h-7 relative"
                    style={{
                      background: 'linear-gradient(180deg, rgba(139, 92, 246, 0.9) 0%, rgba(124, 58, 237, 0.8) 60%, rgba(139, 92, 246, 0.9) 100%)',
                      borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
                      boxShadow: '0 0 20px rgba(139, 92, 246, 0.6), inset 0 2px 6px rgba(255, 255, 255, 0.4), inset 0 -3px 6px rgba(124, 58, 237, 0.5)',
                    }}
                  >
                    {/* Shine */}
                    <div
                      className="absolute top-1 left-1 w-2 h-2 rounded-full"
                      style={{
                        background: 'radial-gradient(circle, rgba(255,255,255,0.8) 0%, transparent 70%)',
                      }}
                    />
                  </div>
                </div>
              )}
            </>

            {/* Impact ripples */}
            <>
              {(phase === 'impact' || phase === 'expand') && (
                <div
                  className="absolute top-28 left-1/2 -translate-x-1/2 animate-[voyo-fade-in_0.3s_ease]"
                >
                  {/* Splash particles */}
                  {[...Array(8)].map((_, i) => (
                    <div
                      key={`splash-${i}`}
                      className="absolute w-1.5 h-1.5 rounded-full"
                      style={{
                        background: 'linear-gradient(135deg, #a78bfa, #8b5cf6)',
                        boxShadow: '0 0 8px rgba(139, 92, 246, 0.8)',
                        transform: `translate(${Math.cos((i * Math.PI * 2) / 8) * 40}px, ${Math.sin((i * Math.PI * 2) / 8) * -30 - 20}px)`,
                        opacity: 0,
                        animation: 'voyo-fade-out 0.6s ease-out forwards',
                      }}
                    />
                  ))}

                  {/* Expanding rings */}
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={`ring-${i}`}
                      className="absolute left-1/2 -translate-x-1/2 rounded-full"
                      style={{
                        border: `${2 - i * 0.3}px solid`,
                        borderColor: `rgba(139, 92, 246, ${0.7 - i * 0.15})`,
                        boxShadow: `0 0 ${10 - i * 2}px rgba(139, 92, 246, ${0.4 - i * 0.1})`,
                        width: 120 + i * 50,
                        height: 40 + i * 15,
                        opacity: 0,
                        animation: `voyo-fade-out 1s ease-out ${i * 0.1}s forwards`,
                      }}
                    />
                  ))}

                  {/* Impact glow */}
                  <div
                    className="absolute left-1/2 -translate-x-1/2 w-8 h-3 rounded-full blur-sm"
                    style={{
                      background: 'linear-gradient(90deg, transparent, rgba(139, 92, 246, 0.8), transparent)',
                      animation: 'voyo-fade-out 0.5s ease-out forwards',
                      transform: 'scaleX(6)',
                    }}
                  />
                </div>
              )}
            </>
          </div>

          {/* Loading status */}
          <div
            className="absolute bottom-20 flex flex-col items-center gap-2 transition-opacity duration-300"
            style={{
              opacity: phase === 'impact' || phase === 'expand' ? 1 : 0,
            }}
          >
            {/* Loading dots */}
            <div className="flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{
                    background: isDataReady ? '#a78bfa' : '#8b5cf6',
                    animationDelay: `${i * 0.15}s`,
                  }}
                />
              ))}
            </div>

            {/* Status text */}
            <p
              className="text-[10px] text-purple-300/40"
            >
              {isDataReady ? 'Ready' : 'Loading tracks...'}
            </p>
          </div>

          {/* Bottom brand */}
          <p
            className="absolute bottom-8 text-[10px] text-purple-400/30 tracking-widest animate-[voyo-fade-in_1s_ease_1s_both]"
          >
            by DASUPERHUB
          </p>
        </div>
      )}
    </>
  );
};

export default VoyoSplash;
