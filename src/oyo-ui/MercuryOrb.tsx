/**
 * MercuryOrb
 * ----------
 * Pure SVG + CSS liquid-mercury orb. The visual centerpiece of the OYO
 * invocation overlay.
 *
 * Technique:
 * --------
 *  1. A circle is drawn with a radial gradient (silver/chrome) inside an
 *     SVG <filter>. The filter chains:
 *
 *       feTurbulence  → procedural Perlin/fractal noise
 *       feDisplacementMap → uses the noise as an x/y offset map for the
 *                           circle, deforming its outline into a wobble
 *
 *  2. The turbulence's `baseFrequency` and the displacement scale are
 *     animated with <animate> elements inside the SVG (NOT JS rAF), so
 *     the entire wobble is GPU-composited and free of React re-renders.
 *
 *  3. Inner highlights, bronze flecks and a soft top spec come from a
 *     stack of additional <ellipse> + <radialGradient> layers under the
 *     same displacement filter, so they wobble *with* the surface.
 *
 *  4. Light beams are 8 absolutely-positioned divs rotating from the
 *     centre, with `mix-blend-mode: screen` and a CSS keyframe shimmer.
 *     Three beams are tinted purple, two bronze, the rest neutral.
 *
 *  5. Outer halo is a CSS `radial-gradient` filter blur ring sitting
 *     under the SVG, breathing with a 6s sine animation.
 *
 * Reactive states:
 * ---------------
 *  - speaking: surface scales 1.10 over 400ms cubic-bezier
 *  - listening: subtle constant pulse (extra halo opacity)
 *  - isPlaying: turbulence baseFrequency cycles slightly faster
 *
 * No three.js, no Canvas, no <video>. Pure SVG + CSS so it stays crisp
 * at any DPI and scales gracefully on low-end mobile.
 */

import { useId, useMemo } from 'react';

interface MercuryOrbProps {
  size?: number;
  speaking?: boolean;
  listening?: boolean;
  isPlaying?: boolean;
}

const BEAMS = [
  { angle: 0, tint: 'rgba(255,255,255,0.55)', delay: '0s' },
  { angle: 45, tint: 'rgba(139, 92, 246, 0.4)', delay: '0.6s' },
  { angle: 90, tint: 'rgba(255,255,255,0.45)', delay: '1.1s' },
  { angle: 135, tint: 'rgba(212, 160, 83, 0.4)', delay: '0.3s' },
  { angle: 180, tint: 'rgba(255,255,255,0.5)', delay: '1.6s' },
  { angle: 225, tint: 'rgba(139, 92, 246, 0.35)', delay: '0.9s' },
  { angle: 270, tint: 'rgba(255,255,255,0.45)', delay: '0.5s' },
  { angle: 315, tint: 'rgba(212, 160, 83, 0.35)', delay: '1.3s' },
] as const;

export function MercuryOrb({
  size = 240,
  speaking = false,
  listening = false,
  isPlaying = false,
}: MercuryOrbProps) {
  // Unique IDs so multiple orbs can coexist (e.g. preview + live)
  const uid = useId().replace(/[:]/g, '');
  const filterId = `oyo-mercury-${uid}`;
  const gradientId = `oyo-mercury-grad-${uid}`;
  const innerId = `oyo-mercury-inner-${uid}`;
  const bronzeId = `oyo-mercury-bronze-${uid}`;
  const haloId = `oyo-mercury-halo-${uid}`;

  // The wobble frequency animates between two states. When the player
  // is active OR OYO is speaking we tighten the noise so it looks more
  // alive; otherwise we keep it slow and "breathing".
  const baseFreq = isPlaying || speaking ? '0.018 0.024' : '0.012 0.016';
  const baseFreqAlt = isPlaying || speaking ? '0.026 0.020' : '0.018 0.014';
  const wobbleScale = speaking ? 18 : isPlaying ? 14 : 10;
  const wobbleScaleAlt = speaking ? 22 : isPlaying ? 17 : 12;

  // Memoise the inline keyframes so React doesn't re-emit on every render
  const styleTag = useMemo(
    () => `
      @keyframes oyo-orb-breathe-${uid} {
        0%, 100% { transform: scale(1); filter: brightness(1); }
        50% { transform: scale(1.015); filter: brightness(1.04); }
      }
      @keyframes oyo-halo-pulse-${uid} {
        0%, 100% { opacity: 0.55; transform: translate(-50%, -50%) scale(1); }
        50% { opacity: 0.75; transform: translate(-50%, -50%) scale(1.06); }
      }
      @keyframes oyo-beam-shimmer-${uid} {
        0%, 100% { opacity: 0.0; transform: translate(-50%, -100%) scaleY(0.65); }
        50% { opacity: 1; transform: translate(-50%, -100%) scaleY(1); }
      }
      @keyframes oyo-spin-slow-${uid} {
        from { transform: translate(-50%, -50%) rotate(0deg); }
        to { transform: translate(-50%, -50%) rotate(360deg); }
      }
      @keyframes oyo-listen-pulse-${uid} {
        0%, 100% { box-shadow: 0 0 80px 8px rgba(139,92,246,0.25), 0 0 140px 16px rgba(212,160,83,0.18); }
        50% { box-shadow: 0 0 100px 12px rgba(139,92,246,0.35), 0 0 180px 24px rgba(212,160,83,0.25); }
      }
    `,
    [uid],
  );

  // Outer container scales when "speaking" — the whole orb leans forward
  const containerScale = speaking ? 1.1 : 1;

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        transform: `scale(${containerScale})`,
        transition: 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      aria-hidden="true"
    >
      <style>{styleTag}</style>

      {/* OUTER HALO — soft glow ring underneath everything */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: size * 1.55,
          height: size * 1.55,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(139,92,246,0.32) 0%, rgba(139,92,246,0.12) 30%, rgba(212,160,83,0.06) 55%, transparent 72%)',
          filter: 'blur(8px)',
          pointerEvents: 'none',
          animation: `oyo-halo-pulse-${uid} 6s ease-in-out infinite`,
          willChange: 'transform, opacity',
        }}
      />

      {/* SECONDARY HALO — bronze fringe */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: size * 1.18,
          height: size * 1.18,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, transparent 55%, rgba(212,160,83,0.18) 68%, transparent 82%)',
          filter: 'blur(4px)',
          pointerEvents: 'none',
          mixBlendMode: 'screen',
        }}
      />

      {/* LIGHT BEAMS — 8 radiating shafts with mix-blend-mode screen */}
      {BEAMS.map((beam, i) => (
        <div
          key={`beam-${i}`}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 3,
            height: size * 0.95,
            transformOrigin: 'top center',
            transform: `translate(-50%, -100%) rotate(${beam.angle}deg) translateY(${size * 0.15}px)`,
            background: `linear-gradient(to top, ${beam.tint} 0%, ${beam.tint} 18%, transparent 100%)`,
            mixBlendMode: 'screen',
            filter: 'blur(1.5px)',
            pointerEvents: 'none',
            opacity: 0,
            animation: `oyo-beam-shimmer-${uid} ${5 + (i % 3)}s ease-in-out ${beam.delay} infinite`,
            willChange: 'opacity, transform',
          }}
        />
      ))}

      {/* SLOW SPINNING RING — gives the whole orb subtle motion */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: size * 1.05,
          height: size * 1.05,
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.05)',
          pointerEvents: 'none',
          animation: `oyo-spin-slow-${uid} 22s linear infinite`,
        }}
      />

      {/* THE MERCURY SVG — wobble via feTurbulence + feDisplacementMap */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: size,
          height: size,
          borderRadius: '50%',
          animation: `oyo-orb-breathe-${uid} 5s ease-in-out infinite${listening ? `, oyo-listen-pulse-${uid} 3s ease-in-out infinite` : ''}`,
          willChange: 'transform, filter',
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 240 240"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <defs>
            {/* Mercury surface gradient: chrome silver with deep purple base */}
            <radialGradient id={gradientId} cx="38%" cy="32%" r="72%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="18%" stopColor="#e8ecf5" stopOpacity="1" />
              <stop offset="42%" stopColor="#c8d0e0" stopOpacity="1" />
              <stop offset="68%" stopColor="#8e95a8" stopOpacity="1" />
              <stop offset="88%" stopColor="#5a5d72" stopOpacity="1" />
              <stop offset="100%" stopColor="#2d2940" stopOpacity="1" />
            </radialGradient>

            {/* Inner highlight — bright chrome top spec */}
            <radialGradient id={innerId} cx="40%" cy="28%" r="32%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
              <stop offset="50%" stopColor="#ffffff" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>

            {/* Bronze warm point — bottom-right */}
            <radialGradient id={bronzeId} cx="68%" cy="72%" r="34%">
              <stop offset="0%" stopColor="#e0c9a0" stopOpacity="0.55" />
              <stop offset="60%" stopColor="#D4A053" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#D4A053" stopOpacity="0" />
            </radialGradient>

            {/* Outer purple halo (rendered inside the svg above the chrome) */}
            <radialGradient id={haloId} cx="50%" cy="50%" r="55%">
              <stop offset="60%" stopColor="#8b5cf6" stopOpacity="0" />
              <stop offset="85%" stopColor="#8b5cf6" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
            </radialGradient>

            {/* THE WOBBLE FILTER */}
            <filter
              id={filterId}
              x="-30%"
              y="-30%"
              width="160%"
              height="160%"
              filterUnits="userSpaceOnUse"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency={baseFreq}
                numOctaves="2"
                seed="7"
                result="turb"
              >
                <animate
                  attributeName="baseFrequency"
                  dur={speaking ? '4s' : '8s'}
                  values={`${baseFreq};${baseFreqAlt};${baseFreq}`}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="seed"
                  dur="20s"
                  values="7;19;42;7"
                  repeatCount="indefinite"
                />
              </feTurbulence>
              <feDisplacementMap
                in="SourceGraphic"
                in2="turb"
                scale={wobbleScale}
                xChannelSelector="R"
                yChannelSelector="G"
              >
                <animate
                  attributeName="scale"
                  dur={speaking ? '3s' : '6s'}
                  values={`${wobbleScale};${wobbleScaleAlt};${wobbleScale}`}
                  repeatCount="indefinite"
                />
              </feDisplacementMap>
            </filter>
          </defs>

          {/* Everything inside this group is wobbled together */}
          <g filter={`url(#${filterId})`}>
            {/* Base mercury sphere */}
            <circle cx="120" cy="120" r="92" fill={`url(#${gradientId})`} />
            {/* Bronze warm point */}
            <ellipse cx="148" cy="155" rx="58" ry="48" fill={`url(#${bronzeId})`} />
            {/* Inner top highlight */}
            <ellipse cx="100" cy="86" rx="48" ry="36" fill={`url(#${innerId})`} />
            {/* Subtle inner ring */}
            <circle
              cx="120"
              cy="120"
              r="84"
              fill="none"
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="0.8"
            />
          </g>

          {/* Outer halo on top (NOT wobbled — keeps a clean glow ring) */}
          <circle cx="120" cy="120" r="118" fill={`url(#${haloId})`} />

          {/* Specular kiss — tiny white spec, NOT inside the wobble group
              so it stays sharp like a real chrome highlight */}
          <ellipse
            cx="98"
            cy="78"
            rx="9"
            ry="5"
            fill="white"
            opacity="0.85"
            style={{ filter: 'blur(0.6px)' }}
          />
          <ellipse
            cx="98"
            cy="78"
            rx="3"
            ry="1.6"
            fill="white"
            opacity="1"
          />
        </svg>
      </div>
    </div>
  );
}

export default MercuryOrb;
