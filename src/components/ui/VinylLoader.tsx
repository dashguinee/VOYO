/**
 * VinylLoader — premium, seamless, predictable loading indicator.
 *
 * Slow-rotating vinyl disc at ~3% opacity. No animate-spin/pulse; the
 * rotation is a single CSS transform at constant angular velocity so it
 * never stutters, never flashes, never draws attention. Tuned to read as
 * "the app is thinking" rather than "something is loading."
 *
 * Used anywhere we previously had Loader2 / animate-spin / animate-pulse —
 * search input spinner, section loaders, etc. Shared component so the
 * feel stays consistent app-wide.
 */

import { memo } from 'react';

interface VinylLoaderProps {
  size?: number;           // px, default 16
  opacity?: number;        // 0-1, default 0.03 (3%)
  className?: string;
  colorClass?: string;     // tailwind text-* class (color currentColor)
}

const VinylLoaderInner = ({
  size = 16,
  opacity = 0.03,
  className = '',
  colorClass = 'text-white',
}: VinylLoaderProps) => {
  return (
    <div
      className={`inline-flex items-center justify-center ${colorClass} ${className}`}
      style={{ width: size, height: size, opacity }}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        style={{
          animation: 'voyo-vinyl-spin 4.8s linear infinite',
        }}
      >
        {/* Outer ring */}
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" />
        {/* Groove rings */}
        <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="0.5" />
        <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="0.5" />
        {/* Spindle */}
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      </svg>
      <style>{`
        @keyframes voyo-vinyl-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export const VinylLoader = memo(VinylLoaderInner);
export default VinylLoader;
