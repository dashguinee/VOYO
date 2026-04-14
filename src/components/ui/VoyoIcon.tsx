/**
 * VoyoIcon — bronze-gold + amethyst purple glossy 3D icons with VOYO DNA.
 * Generated via Imagen 4 (scripts/generate-voyo-icons.cjs).
 *
 * Drop-in replacement for lucide's Music2 / Heart / Radio / Disc3 etc. in
 * places where we want the premium feel instead of generic line icons.
 *
 * Use sparingly — these are PNG hero icons (~1MB at full res). Reach for
 * them on header art, empty states, hero CTAs. For dense in-list usage,
 * keep the lucide outlines so rows stay light.
 */

import { CSSProperties } from 'react';

export type VoyoIconName =
  | 'music-note'    // Tracks / generic music
  | 'vinyl-disc'    // Albums
  | 'radio-vibes'   // Vibes / radio / mood
  | 'compass-disco' // Disco / navigation
  | 'heart-like'    // Like / favorite
  | 'sparkle-smart' // Smart Mix / AI / magic
  | 'orb-artist'    // Artists / creators
  | 'bucket-queue'; // Queue / bucket

interface VoyoIconProps {
  name: VoyoIconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  alt?: string;
  /** Optional glow ring behind the icon (matches the cozy atmosphere). */
  glow?: boolean;
}

export const VoyoIcon = ({ name, size = 32, className, style, alt, glow = false }: VoyoIconProps) => {
  const src = `/icons/${name}.png`;
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        width: size,
        height: size,
        position: 'relative',
        flexShrink: 0,
        ...(glow && {
          filter: `drop-shadow(0 0 ${size * 0.25}px rgba(212,175,110,0.45)) drop-shadow(0 0 ${size * 0.4}px rgba(139,92,246,0.18))`,
        }),
        ...style,
      }}
    >
      <img
        src={src}
        alt={alt || name.replace('-', ' ')}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
    </span>
  );
};

export default VoyoIcon;
