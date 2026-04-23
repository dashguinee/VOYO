/**
 * VoyoLoadOrb — A premium, artistic load indicator. Not a spinner.
 *
 * Uses a soft breathing radial gradient. Zero motion jank, GPU-only transforms.
 * Replaces hard-spin animate-spin borders in VOYO's critical loading paths.
 */

export function VoyoLoadOrb({ size = 64, className = '' }: { size?: number; className?: string }) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background:
          'radial-gradient(circle, rgba(168, 85, 247, 0.55) 0%, rgba(212, 160, 83, 0.28) 45%, rgba(0, 0, 0, 0) 75%)',
        filter: 'blur(1px)',
        animation: 'voyo-orb-breathe 2.4s ease-in-out infinite',
        willChange: 'transform, opacity',
      }}
      aria-label="Loading"
      role="status"
    />
  );
}
