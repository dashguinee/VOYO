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
  const doneRef = useRef(false);

  const initDownloads = useDownloadStore((s) => s.initialize);
  // Touch selector to mount the store — do NOT put in effect deps (object
  // reference changes every render after initDownloads mutates the store,
  // causing an infinite re-run loop).
  usePreferenceStore((s) => s.trackPreferences);

  // Init stores once on mount. Hard 3s cap — never blocks the splash.
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

  // Phase timeline: bar → pulse → out → done
  // Total guaranteed exit: minDuration + 500ms pulse + 220ms fade
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
      {phase === 'bar' && (
        <div className="flex flex-col items-center gap-2">
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
