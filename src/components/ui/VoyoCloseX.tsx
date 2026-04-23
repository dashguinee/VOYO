import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

type Size = 'sm' | 'md' | 'lg';

interface VoyoCloseXProps {
  onClose: () => void;
  size?: Size;
  ariaLabel?: string;
  className?: string;
}

const PILL_SIZE: Record<Size, { box: number; icon: number }> = {
  sm: { box: 28, icon: 14 },
  md: { box: 34, icon: 16 },
  lg: { box: 40, icon: 18 },
};

/**
 * VoyoCloseX — plush velvet close button.
 *
 * Personality:
 *  • Dark purple radial-gradient pill with velvet-press inset shadows
 *    (matches the Vibes on Vibes play button language).
 *  • Starts visible at 80% opacity, fades to 0 over ~2s after a 1.8s hold.
 *  • Any pointer movement / interaction globally restores to 80% instantly.
 *  • Remains pointer-events:auto even while invisible so taps still land.
 *  • `prefers-reduced-motion` → stays at 80% permanently (no fade).
 */
export function VoyoCloseX({
  onClose,
  size = 'md',
  ariaLabel = 'Close',
  className = '',
}: VoyoCloseXProps) {
  const { box, icon } = PILL_SIZE[size];
  const [visible, setVisible] = useState(true);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;

    const arm = () => {
      setVisible(true);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = setTimeout(() => setVisible(false), 1800);
    };

    arm();

    const events: Array<keyof WindowEventMap> = ['pointermove', 'pointerdown', 'keydown', 'touchstart'];
    for (const ev of events) window.addEventListener(ev, arm, { passive: true });

    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      for (const ev of events) window.removeEventListener(ev, arm);
    };
  }, []);

  return (
    <button
      onClick={onClose}
      aria-label={ariaLabel}
      className={`relative rounded-full flex items-center justify-center overflow-hidden active:scale-95 transition-transform ${className}`}
      style={{
        width: box,
        height: box,
        background:
          'radial-gradient(circle at 32% 24%, rgba(167,139,250,0.42) 0%, rgba(73,24,114,0.95) 44%, rgba(32,13,58,0.95) 100%)',
        boxShadow:
          'inset 0 1px 1px rgba(255,255,255,0.18), inset 0 -2px 5px rgba(0,0,0,0.48), 0 4px 10px rgba(0,0,0,0.35), 0 0 0 1px rgba(167,139,250,0.16)',
        opacity: visible ? 0.8 : 0,
        pointerEvents: 'auto',
        transition: 'opacity 2s ease, transform 80ms ease',
      }}
    >
      <X
        size={icon}
        className="text-white relative z-10"
        strokeWidth={2.2}
        style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.4))' }}
      />
    </button>
  );
}

export default VoyoCloseX;
