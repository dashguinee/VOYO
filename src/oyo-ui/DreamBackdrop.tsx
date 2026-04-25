/**
 * DreamBackdrop
 * -------------
 * The "reality bends" overlay that fades in behind the MercuryOrb.
 *
 * Layers (back to front):
 *   1. backdrop-filter blur(24px) — reads the underlying app and blurs it
 *   2. dark gradient wash — pulls focus to the centre
 *   3. warm bronze + purple bloom — radial breathing
 *   4. subtle vignette — dark edges
 *   5. drifting ambient particles — purple, bronze, white pinpricks
 *
 * Entry: fade-in + scale-in (0.95 -> 1) over 500ms ease-out, like the
 * camera pushing forward in an anime "transformation" cut.
 *
 * Exit: reverse — fade-out + scale-out, 360ms ease-in.
 *
 * Tap-anywhere-to-dismiss (the chat surface lifts pointer events back
 * up where it needs them).
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';

// Module-level counter so each new mount gets a fresh particle seed
// without calling impure Date.now() during render.
let mountSeq = 0;

interface DreamBackdropProps {
  visible: boolean;
  onDismiss: () => void;
  children?: React.ReactNode;
}

interface Particle {
  left: string;
  top: string;
  size: number;
  color: string;
  duration: string;
  delay: string;
}

const PARTICLE_COUNT = 18;

function generateParticles(seed: number): Particle[] {
  // Simple LCG so the particle pattern is stable per mount but still
  // varied between mounts (uses seed = invocationKey).
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const colors = [
    'rgba(255, 255, 255, 0.85)',
    'rgba(212, 160, 83, 0.75)',
    'rgba(139, 92, 246, 0.7)',
    'rgba(255, 255, 255, 0.55)',
    'rgba(212, 160, 83, 0.5)',
  ];
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    left: `${10 + rnd() * 80}%`,
    top: `${10 + rnd() * 80}%`,
    size: 1.5 + rnd() * 2.5,
    color: colors[Math.floor(rnd() * colors.length)],
    duration: `${8 + rnd() * 10}s`,
    delay: `${rnd() * 6}s`,
  }));
}

export function DreamBackdrop({ visible, onDismiss, children }: DreamBackdropProps) {
  const uid = useId().replace(/[:]/g, '');
  // Stable per-mount particle seed (computed once via lazy state init)
  const [particleSeed] = useState(() => ++mountSeq);
  const [mounted, setMounted] = useState(visible);
  const [active, setActive] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Two-phase mount: keep the node in the DOM during the exit anim,
  // unmount once the fade-out completes.
  useEffect(() => {
    if (visible) {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      setMounted(true);
      // Next tick → flip active so the CSS transition runs
      const id = requestAnimationFrame(() => setActive(true));
      return () => cancelAnimationFrame(id);
    } else {
      setActive(false);
      exitTimerRef.current = setTimeout(() => setMounted(false), 380);
      return () => {
        if (exitTimerRef.current) {
          clearTimeout(exitTimerRef.current);
        }
      };
    }
  }, [visible]);

  // Particles regenerate per mount (seed is stable for the life of the mount)
  const particles = useMemo(
    () => generateParticles(uid.length + particleSeed * 7919),
    [uid, particleSeed],
  );

  // Handle escape key
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onDismiss]);

  if (!mounted) return null;

  const styleTag = `
    @keyframes oyo-bloom-${uid} {
      0%, 100% {
        opacity: 0.55;
        transform: scale(1) translate(0, 0);
      }
      50% {
        opacity: 0.75;
        transform: scale(1.08) translate(0, -2%);
      }
    }
    @keyframes oyo-particle-drift-${uid} {
      0% { transform: translate(0, 0) scale(1); opacity: 0; }
      15% { opacity: 1; }
      50% { transform: translate(8px, -14px) scale(1.15); opacity: 1; }
      85% { opacity: 1; }
      100% { transform: translate(-6px, -28px) scale(0.9); opacity: 0; }
    }
  `;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="OYO summoned"
      className="fixed inset-0 z-[9000]"
      style={{
        opacity: active ? 1 : 0,
        transform: active ? 'scale(1)' : 'scale(0.96)',
        transition:
          'opacity 480ms cubic-bezier(0.22, 1, 0.36, 1), transform 520ms cubic-bezier(0.22, 1, 0.36, 1)',
        pointerEvents: visible ? 'auto' : 'none',
      }}
      onClick={(e) => {
        // Tap-on-backdrop dismisses; the chat layer stops propagation
        // for its own clicks.
        if (e.target === e.currentTarget) {
          onDismiss();
        }
      }}
    >
      <style>{styleTag}</style>

      {/* Layer 1: blur the world behind */}
      <div
        className="absolute inset-0"
        style={{
          backdropFilter: 'blur(12px) saturate(110%) brightness(0.6)',
          WebkitBackdropFilter: 'blur(12px) saturate(110%) brightness(0.6)',
          background: 'rgba(8, 6, 16, 0.45)',
        }}
      />

      {/* Layer 2: dark wash with subtle warm centre */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(20, 12, 36, 0.4) 0%, rgba(8, 4, 18, 0.85) 70%, rgba(4, 2, 10, 0.95) 100%)',
        }}
      />

      {/* Layer 3: warm bronze + purple bloom — breathing */}
      <div
        className="absolute"
        style={{
          left: '50%',
          top: '38%',
          transform: 'translate(-50%, -50%)',
          width: '90vmin',
          height: '90vmin',
          background:
            'radial-gradient(circle, rgba(212, 160, 83, 0.22) 0%, rgba(139, 92, 246, 0.18) 28%, rgba(139, 92, 246, 0.06) 55%, transparent 78%)',
          filter: 'blur(20px)',
          mixBlendMode: 'screen',
          animation: `oyo-bloom-${uid} 8s ease-in-out infinite`,
          willChange: 'opacity, transform',
          pointerEvents: 'none',
        }}
      />

      {/* Layer 4: vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 95%)',
        }}
      />

      {/* Layer 5: drifting ambient particles */}
      <div className="absolute inset-0 pointer-events-none">
        {particles.map((p, i) => (
          <span
            key={`p-${i}`}
            style={{
              position: 'absolute',
              left: p.left,
              top: p.top,
              width: p.size,
              height: p.size,
              borderRadius: '50%',
              background: p.color,
              boxShadow: `0 0 ${p.size * 4}px ${p.color}`,
              animation: `oyo-particle-drift-${uid} ${p.duration} ease-in-out ${p.delay} infinite`,
              willChange: 'transform, opacity',
            }}
          />
        ))}
      </div>

      {/* Children = the orb + chat */}
      {children}
    </div>
  );
}

export default DreamBackdrop;
