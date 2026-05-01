import { useState, useEffect, useRef } from 'react';
import { useDownloadStore } from '../../store/downloadStore';
import { usePreferenceStore } from '../../store/preferenceStore';
import { devLog, devWarn } from '../../utils/logger';

interface VoyoSplashProps {
  onComplete: () => void;
  minDuration?: number;
}

export const VoyoSplash = ({ onComplete, minDuration = 1200 }: VoyoSplashProps) => {
  const [phase, setPhase] = useState<'bar' | 'pulse' | 'out'>('bar');
  const [isDataReady, setIsDataReady] = useState(false);
  const hasCompletedRef = useRef(false);
  const isDataReadyRef = useRef(false);

  const initDownloads = useDownloadStore((s) => s.initialize);
  const trackPreferences = usePreferenceStore((s) => s.trackPreferences);

  // Store init in background
  useEffect(() => {
    const run = async () => {
      try {
        devLog('BOOT: init stores…');
        await Promise.race([
          initDownloads(),
          new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 3000)),
        ]).catch((e) => devWarn('BOOT: IndexedDB timeout', e));
        devLog('BOOT: stores ready', Object.keys(trackPreferences).length, 'tracks');
      } catch (e) {
        devWarn('BOOT: init error', e);
      }
      isDataReadyRef.current = true;
      setIsDataReady(true);
    };
    run();
    const safety = setTimeout(() => {
      if (!isDataReadyRef.current) { isDataReadyRef.current = true; setIsDataReady(true); }
    }, 5000);
    return () => clearTimeout(safety);
  }, [initDownloads, trackPreferences]);

  // Phase 1 → bar for minDuration, then switch to pulse
  useEffect(() => {
    const t = setTimeout(() => setPhase('pulse'), minDuration);
    return () => clearTimeout(t);
  }, [minDuration]);

  // Phase 2 → pulse for 500ms, then fade out
  useEffect(() => {
    if (phase !== 'pulse') return;
    const t = setTimeout(() => setPhase('out'), 500);
    return () => clearTimeout(t);
  }, [phase]);

  // Phase 3 → out: wait for data + fade, then complete
  useEffect(() => {
    if (phase !== 'out' || hasCompletedRef.current) return;
    if (!isDataReady) return;
    hasCompletedRef.current = true;
    const t = setTimeout(() => onComplete(), 220);
    return () => clearTimeout(t);
  }, [phase, isDataReady, onComplete]);

  // If data isn't ready yet when we hit 'out', wait for it
  useEffect(() => {
    if (phase === 'out' && isDataReady && !hasCompletedRef.current) {
      hasCompletedRef.current = true;
      const t = setTimeout(() => onComplete(), 220);
      return () => clearTimeout(t);
    }
  }, [phase, isDataReady, onComplete]);

  const isOut = phase === 'out';

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#050508]"
      style={{
        opacity: isOut ? 0 : 1,
        transition: 'opacity 220ms ease-out',
        pointerEvents: isOut ? 'none' : 'auto',
        fontFamily: "'Satoshi', system-ui, sans-serif",
      }}
    >
      {phase === 'bar' && (
        <div className="flex flex-col items-center gap-2">
          <h1
            className="text-lg font-bold text-white"
            style={{ letterSpacing: '0.05em' }}
          >
            VOYO
          </h1>
          <div className="w-10 h-[2px] rounded-full overflow-hidden bg-white/5">
            <div
              className="h-full w-full rounded-full"
              style={{
                background: 'rgba(139, 92, 246, 0.5)',
                animation: 'voyo-loading-bar 1.5s ease-in-out infinite',
              }}
            />
          </div>
        </div>
      )}

      {(phase === 'pulse' || phase === 'out') && (
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-purple-500/50 animate-pulse"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      )}

      <style>{`
        @keyframes voyo-loading-bar {
          0%, 100% { transform: translateX(-100%); }
          50%       { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};

export default VoyoSplash;
