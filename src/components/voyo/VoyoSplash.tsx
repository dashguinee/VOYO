import { useState, useEffect, useRef } from 'react';
import { useDownloadStore } from '../../store/downloadStore';
import { usePreferenceStore } from '../../store/preferenceStore';
import { devLog, devWarn } from '../../utils/logger';

interface VoyoSplashProps {
  onComplete: () => void;
  minDuration?: number;
}

export const VoyoSplash = ({ onComplete, minDuration = 900 }: VoyoSplashProps) => {
  const [phase, setPhase] = useState<'bar' | 'pulse' | 'out'>('bar');
  const [boomFired, setBoomFired] = useState(false);
  const doneRef = useRef(false);

  const initDownloads = useDownloadStore((s) => s.initialize);
  usePreferenceStore((s) => s.trackPreferences);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        devLog('BOOT: init stores');
        await Promise.race([
          initDownloads(),
          new Promise<void>((_, r) => setTimeout(() => r(new Error('timeout')), 3000)),
        ]).catch((e) => devWarn('BOOT: init timeout', e));
      } catch (e) {
        devWarn('BOOT: init error', e);
      }
      if (!cancelled) devLog('BOOT: stores ready');
    };
    void run();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Boom rings fire 80ms after mount — just enough for the first paint
  // to settle so the animation is visible from its true start.
  useEffect(() => {
    const t = setTimeout(() => setBoomFired(true), 80);
    return () => clearTimeout(t);
  }, []);

  // Phase timeline: bar → pulse → out → done
  useEffect(() => {
    const t1 = setTimeout(() => setPhase('pulse'), minDuration);
    const t2 = setTimeout(() => setPhase('out'),   minDuration + 500);
    const t3 = setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      onComplete();
    }, minDuration + 500 + 220);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#050508]"
      style={{
        opacity: phase === 'out' ? 0 : 1,
        transition: 'opacity 220ms ease-out',
        pointerEvents: phase === 'out' ? 'none' : 'auto',
        fontFamily: "'Satoshi', system-ui, sans-serif",
      }}
    >
      {/* Boom-expand ring burst — 3 staggered rings radiate from the wordmark */}
      {boomFired && [0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden
          style={{
            position: 'absolute',
            width: 120,
            height: 120,
            borderRadius: '50%',
            border: '1.5px solid rgba(139, 92, 246, 0.55)',
            animation: `voyo-boom-ring 640ms cubic-bezier(0.2, 0, 0.8, 1) ${i * 110}ms forwards`,
            pointerEvents: 'none',
          }}
        />
      ))}

      {phase === 'bar' && (
        <div className="flex flex-col items-center gap-2" style={{ position: 'relative', zIndex: 1 }}>
          <h1 className="text-lg font-bold text-white" style={{ letterSpacing: '0.05em' }}>
            VOYO
          </h1>
          <div className="w-10 h-[2px] rounded-full overflow-hidden bg-white/5">
            <div
              className="h-full w-full rounded-full"
              style={{ background: 'rgba(139, 92, 246, 0.5)', animation: 'voyo-loading-bar 1.5s ease-in-out infinite' }}
            />
          </div>
        </div>
      )}

      {(phase === 'pulse' || phase === 'out') && (
        <div className="flex items-center gap-1.5" style={{ position: 'relative', zIndex: 1 }}>
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
        @keyframes voyo-boom-ring {
          0%   { transform: scale(0.15); opacity: 0.75; }
          60%  { opacity: 0.35; }
          100% { transform: scale(2.8); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default VoyoSplash;
