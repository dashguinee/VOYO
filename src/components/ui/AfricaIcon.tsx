/**
 * AfricaIcon — Spinning globe with fixed, bouncing African continent
 *
 * - Outer orbital rings spin (like a globe)
 * - Africa continent stays fixed, with a gentle bounce
 * - Vertical beams inside Africa pulse like an equalizer/heartbeat
 * - Pure SVG + CSS, no dependencies, ~2KB
 *
 * Brand-matched: purple (#8b5cf6) + African Gold Bronze (#D4A053)
 */

interface AfricaIconProps {
  size?: number;
  className?: string;
  /** Speed of orbital rotation in seconds (default 8s) */
  orbitSpeed?: number;
}

export const AfricaIcon = ({ size = 64, className = '', orbitSpeed = 8 }: AfricaIconProps) => {
  return (
    <div
      className={`africa-icon relative inline-block ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Bronze gradient for the continent fill */}
          <linearGradient id="africa-bronze" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#E6B865" />
            <stop offset="50%" stopColor="#D4A053" />
            <stop offset="100%" stopColor="#A67A3A" />
          </linearGradient>

          {/* Purple glow for the orbital rings */}
          <linearGradient id="ring-purple" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.1" />
            <stop offset="50%" stopColor="#a78bfa" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.1" />
          </linearGradient>

          {/* Clip the beams to the Africa shape */}
          <clipPath id="africa-clip">
            <path d="M 30,16
                     C 34,14 38,13 44,13
                     C 50,13 56,13 62,14
                     C 66,14 70,15 72,18
                     C 73,22 72,26 73,30
                     C 74,32 76,33 78,34
                     C 80,36 82,39 80,42
                     C 78,44 75,43 72,44
                     C 70,45 68,48 67,52
                     C 66,56 65,60 64,64
                     C 62,68 60,72 57,76
                     C 54,80 51,83 48,85
                     C 46,86 44,85 43,82
                     C 42,78 43,74 42,70
                     C 40,66 37,63 35,59
                     C 33,55 31,51 30,47
                     C 29,44 27,42 26,40
                     C 24,37 23,34 25,32
                     C 27,30 29,30 31,29
                     C 32,26 30,23 28,21
                     C 26,19 26,17 30,16 Z" />
          </clipPath>

          {/* Radial gradient for the inner glow behind Africa */}
          <radialGradient id="inner-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Inner glow behind everything */}
        <circle cx="50" cy="50" r="45" fill="url(#inner-glow)" className="africa-icon-glow" />

        {/* Orbital ring 1 — equator, spinning horizontally */}
        <g className="africa-icon-ring-1">
          <ellipse
            cx="50"
            cy="50"
            rx="44"
            ry="12"
            stroke="url(#ring-purple)"
            strokeWidth="1.2"
            fill="none"
            opacity="0.7"
          />
        </g>

        {/* Orbital ring 2 — tilted, opposite direction */}
        <g className="africa-icon-ring-2">
          <ellipse
            cx="50"
            cy="50"
            rx="44"
            ry="18"
            stroke="url(#ring-purple)"
            strokeWidth="1"
            fill="none"
            opacity="0.5"
            transform="rotate(-30 50 50)"
          />
        </g>

        {/* Orbital ring 3 — fine, fast spin */}
        <g className="africa-icon-ring-3">
          <ellipse
            cx="50"
            cy="50"
            rx="46"
            ry="8"
            stroke="#8b5cf6"
            strokeWidth="0.6"
            fill="none"
            opacity="0.35"
            transform="rotate(60 50 50)"
          />
        </g>

        {/* Africa continent — fixed, gentle bounce */}
        <g className="africa-icon-continent">
          {/* Shadow under the continent */}
          <path
            d="M 30,16 C 34,14 38,13 44,13 C 50,13 56,13 62,14 C 66,14 70,15 72,18 C 73,22 72,26 73,30 C 74,32 76,33 78,34 C 80,36 82,39 80,42 C 78,44 75,43 72,44 C 70,45 68,48 67,52 C 66,56 65,60 64,64 C 62,68 60,72 57,76 C 54,80 51,83 48,85 C 46,86 44,85 43,82 C 42,78 43,74 42,70 C 40,66 37,63 35,59 C 33,55 31,51 30,47 C 29,44 27,42 26,40 C 24,37 23,34 25,32 C 27,30 29,30 31,29 C 32,26 30,23 28,21 C 26,19 26,17 30,16 Z"
            fill="#000"
            opacity="0.4"
            transform="translate(1 1.5)"
          />

          {/* The continent — bronze fill with subtle border */}
          <path
            d="M 30,16
               C 34,14 38,13 44,13
               C 50,13 56,13 62,14
               C 66,14 70,15 72,18
               C 73,22 72,26 73,30
               C 74,32 76,33 78,34
               C 80,36 82,39 80,42
               C 78,44 75,43 72,44
               C 70,45 68,48 67,52
               C 66,56 65,60 64,64
               C 62,68 60,72 57,76
               C 54,80 51,83 48,85
               C 46,86 44,85 43,82
               C 42,78 43,74 42,70
               C 40,66 37,63 35,59
               C 33,55 31,51 30,47
               C 29,44 27,42 26,40
               C 24,37 23,34 25,32
               C 27,30 29,30 31,29
               C 32,26 30,23 28,21
               C 26,19 26,17 30,16 Z"
            fill="url(#africa-bronze)"
            stroke="#E6B865"
            strokeWidth="0.8"
            strokeLinejoin="round"
          />

          {/* Beams inside Africa — clipped to continent shape, vertical EQ-style */}
          <g clipPath="url(#africa-clip)">
            <rect className="africa-icon-beam-1" x="34" y="12" width="3" height="78" rx="1.5" fill="#FFE5B4" opacity="0.55" />
            <rect className="africa-icon-beam-2" x="42" y="12" width="3" height="78" rx="1.5" fill="#FFE5B4" opacity="0.65" />
            <rect className="africa-icon-beam-3" x="50" y="12" width="3" height="78" rx="1.5" fill="#FFE5B4" opacity="0.6" />
            <rect className="africa-icon-beam-4" x="58" y="12" width="3" height="78" rx="1.5" fill="#FFE5B4" opacity="0.5" />
          </g>

          {/* Highlight on the continent's north edge */}
          <path
            d="M 34,16 C 42,13 52,13 62,14"
            stroke="#FFE5B4"
            strokeWidth="0.8"
            strokeLinecap="round"
            opacity="0.5"
            fill="none"
          />
        </g>
      </svg>

      <style>{`
        .africa-icon {
          filter: drop-shadow(0 0 12px rgba(212, 160, 83, 0.3));
        }

        /* Rings spin at different speeds and directions */
        .africa-icon-ring-1 {
          transform-origin: 50% 50%;
          animation: africa-ring-spin ${orbitSpeed}s linear infinite;
        }
        .africa-icon-ring-2 {
          transform-origin: 50% 50%;
          animation: africa-ring-spin-rev ${orbitSpeed * 1.6}s linear infinite;
        }
        .africa-icon-ring-3 {
          transform-origin: 50% 50%;
          animation: africa-ring-spin ${orbitSpeed * 0.6}s linear infinite;
        }

        @keyframes africa-ring-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes africa-ring-spin-rev {
          from { transform: rotate(0deg); }
          to { transform: rotate(-360deg); }
        }

        /* Continent bounces gently — scale + subtle vertical travel */
        .africa-icon-continent {
          transform-origin: 50% 50%;
          animation: africa-bounce 2.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
        @keyframes africa-bounce {
          0%, 100%  { transform: translateY(0) scale(1); }
          50%       { transform: translateY(-2px) scale(1.04); }
        }

        /* Inner glow pulses with the bounce */
        .africa-icon-glow {
          transform-origin: 50% 50%;
          animation: africa-glow-pulse 2.8s ease-in-out infinite;
        }
        @keyframes africa-glow-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50%      { opacity: 0.8; transform: scale(1.1); }
        }

        /* Beams pulse at different rates — music energy */
        .africa-icon-beam-1 { animation: africa-beam-1 1.1s ease-in-out infinite; transform-origin: 50% 100%; }
        .africa-icon-beam-2 { animation: africa-beam-2 0.9s ease-in-out infinite; transform-origin: 50% 100%; }
        .africa-icon-beam-3 { animation: africa-beam-3 1.3s ease-in-out infinite; transform-origin: 50% 100%; }
        .africa-icon-beam-4 { animation: africa-beam-4 1.0s ease-in-out infinite; transform-origin: 50% 100%; }

        @keyframes africa-beam-1 {
          0%, 100% { transform: scaleY(0.3); opacity: 0.3; }
          50%      { transform: scaleY(0.95); opacity: 0.7; }
        }
        @keyframes africa-beam-2 {
          0%, 100% { transform: scaleY(0.9); opacity: 0.8; }
          50%      { transform: scaleY(0.4); opacity: 0.5; }
        }
        @keyframes africa-beam-3 {
          0%, 100% { transform: scaleY(0.5); opacity: 0.55; }
          50%      { transform: scaleY(1); opacity: 0.8; }
        }
        @keyframes africa-beam-4 {
          0%, 100% { transform: scaleY(0.7); opacity: 0.4; }
          50%      { transform: scaleY(0.3); opacity: 0.6; }
        }

        @media (prefers-reduced-motion: reduce) {
          .africa-icon-ring-1,
          .africa-icon-ring-2,
          .africa-icon-ring-3,
          .africa-icon-continent,
          .africa-icon-glow,
          .africa-icon-beam-1,
          .africa-icon-beam-2,
          .africa-icon-beam-3,
          .africa-icon-beam-4 { animation: none; }
        }
      `}</style>
    </div>
  );
};

export default AfricaIcon;
