/**
 * AtmosphereLayer — emergent cozy field that lives behind the entire app.
 *
 * Three layers, all CSS-only (zero JS animation cost):
 *   1. TopFade        — soft amber wash at the top so content emerges from
 *                       atmosphere instead of from a hard rectangle edge.
 *   2. ParticleDrift  — slow rising warm motes (champagne / faded gold).
 *                       Like dust caught in golden-hour light through a
 *                       window with vinyl playing in the next room.
 *   3. CornerVignette — barely-there radial darkening at corners, focuses
 *                       eye on center content, removes "screen on monitor"
 *                       feeling, adds "lit room" feeling.
 *
 * All amber-tinted to match the cozy 1900-2200K firelight palette established
 * in VoyoMoments (rgba(20,12,6,x) base + #C9A96C / #E5D4A8 accents).
 *
 * Performance: pointer-events: none everywhere, low z-index, GPU-composited
 * transforms only. 28 particles is the sweet spot — visible texture without
 * eating frame budget on mid-range Android.
 *
 * CSS transforms only — no canvas. 28 particles is the sweet spot for visible texture without frame budget cost on mid-range Android.
 */

import { useEffect, useMemo } from 'react';

const PARTICLE_COUNT = 28;

// Warm palette — champagne, faded gold, ember, dusk amber.
// Each particle picks one. Saturation kept low so they read as "atmosphere"
// not "decoration".
const PARTICLE_COLORS = [
  'rgba(229, 212, 168, 0.55)',  // champagne
  'rgba(201, 169, 108, 0.45)',  // faded gold
  'rgba(212, 175, 110, 0.50)',  // bronze
  'rgba(255, 179, 123, 0.35)',  // dusk amber
  'rgba(232, 208, 158, 0.40)',  // pale gold
];

interface Particle {
  size: number;
  left: number;       // %
  driftX: number;     // px sideways drift
  duration: number;   // s for one full bottom-to-top trip
  delay: number;      // s, can be negative to start mid-flight
  color: string;
  blur: number;
}

function buildParticles(seed: number): Particle[] {
  // Deterministic per-mount so particles don't re-shuffle on re-render.
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  return Array.from({ length: PARTICLE_COUNT }, (): Particle => {
    const size = 2 + rand() * 4.5;
    return {
      size,
      left: rand() * 100,
      driftX: (rand() - 0.5) * 80,
      duration: 65 + rand() * 95,           // 65-160s
      delay: -rand() * 160,                 // start mid-flight, no big intro burst
      color: PARTICLE_COLORS[Math.floor(rand() * PARTICLE_COLORS.length)],
      blur: rand() < 0.4 ? 1 : 0,
    };
  });
}

export const AtmosphereLayer = () => {
  const particles = useMemo(() => buildParticles(Math.floor(Date.now() / 86400000)), []);

  // Drives --voyo-scroll-vis CSS var from 1 (top) → 0 (≥50% scrolled) so
  // the bronze-gold scrollbar fades to nothing in the lower half.
  // Capture-phase listener because inner scroll containers are more common than window scroll.
  useEffect(() => {
    let raf = 0;
    const update = (target: EventTarget | null) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = target as (HTMLElement | Document | null);
        let pct = 0;
        if (el && 'scrollTop' in (el as HTMLElement)) {
          const e = el as HTMLElement;
          const max = Math.max(1, e.scrollHeight - e.clientHeight);
          pct = Math.min(1, Math.max(0, e.scrollTop / max));
        } else {
          const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
          pct = Math.min(1, Math.max(0, window.scrollY / max));
        }
        // Full visible 0–50%, linear fade 50–100% → 0
        const vis = pct < 0.5 ? 1 : Math.max(0, 1 - (pct - 0.5) * 2);
        document.documentElement.style.setProperty('--voyo-scroll-vis', vis.toFixed(3));
      });
    };
    const onScroll = (e: Event) => update(e.target);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      {/* Keyframes — defined once, shared by every particle */}
      <style>{`
        @keyframes voyo-drift-up {
          0%   { transform: translate(0, 8vh); opacity: 0; }
          8%   { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translate(var(--drift-x, 0), -110vh); opacity: 0; }
        }
        @keyframes voyo-atmosphere-breathe {
          0%, 100% { opacity: 0.85; }
          50%      { opacity: 1; }
        }
      `}</style>

      {/* L1 — Top fade. Soft amber wash, content emerges out of atmosphere. */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: 0, left: 0, right: 0,
          height: '40vh',
          background: 'linear-gradient(to bottom, rgba(20,12,6,0.55) 0%, rgba(20,12,6,0.22) 35%, rgba(20,12,6,0.06) 70%, transparent 100%)',
          zIndex: 1,
          pointerEvents: 'none',
          animation: 'voyo-atmosphere-breathe 14s ease-in-out infinite',
        }}
      />

      {/* L2 — Particle drift. Warm motes rising slowly through the field. */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        {particles.map((p, i) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              bottom: -10,
              left: `${p.left}%`,
              width: p.size,
              height: p.size,
              borderRadius: '50%',
              background: p.color,
              boxShadow: `0 0 ${p.size * 2.5}px ${p.color}`,
              filter: p.blur ? 'blur(0.5px)' : 'none',
              animation: `voyo-drift-up ${p.duration}s linear infinite`,
              animationDelay: `${p.delay}s`,
              willChange: p.blur ? 'auto' : 'transform, opacity',
              ['--drift-x' as any]: `${p.driftX}px`,
            }}
          />
        ))}
      </div>

      {/* L3 — Corner vignette. Barely-there radial darkening, lit-room feel. */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1,
          pointerEvents: 'none',
          background: 'radial-gradient(ellipse at center, transparent 35%, rgba(11,7,3,0.32) 100%)',
        }}
      />
    </>
  );
};

export default AtmosphereLayer;
