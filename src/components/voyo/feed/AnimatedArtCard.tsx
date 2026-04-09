/**
 * AnimatedArtCard - Animated Album Art Content Type
 *
 * For tracks without video, we create engaging visual content:
 * - Album art with pulse/glow effects synced to BPM
 * - Waveform visualization
 * - Particle effects
 * - Color shifting based on album dominant colors
 *
 * This is "content" - an animated visual that works as feed material
 * Think: Spotify Canvas but for the feed
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { Music2, Disc3 } from 'lucide-react';
import { SmartImage } from '../../ui/SmartImage';

// Display modes for static content
export type ArtDisplayMode = 'oval' | 'disc' | 'fullscreen';

interface AnimatedArtCardProps {
  trackId: string;
  thumbnail: string;
  isActive: boolean;
  isPlaying: boolean;
  bpm?: number; // Beats per minute for sync
  dominantColor?: string; // Extracted from album art
  displayMode?: ArtDisplayMode; // oval = floating oval, disc = CD, fullscreen = zoomed fill
}

// Estimate BPM from genre or default
const DEFAULT_BPM = 120;

// Generate particles
const generateParticles = (count: number) => {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    size: 2 + Math.random() * 4,
    delay: Math.random() * 2,
  }));
};

export const AnimatedArtCard = ({
  trackId,
  thumbnail,
  isActive,
  isPlaying,
  bpm = DEFAULT_BPM,
  dominantColor = '#a855f7',
  displayMode = 'oval', // Default to floating oval
}: AnimatedArtCardProps) => {
  const [imageLoaded, setImageLoaded] = useState(false);

  // Calculate animation duration from BPM
  const beatDuration = 60 / bpm; // Seconds per beat

  // ============================================
  // FLOATING OVAL MODE - Album art in oval shape floating in darkness
  // ============================================
  if (displayMode === 'oval') {
    return (
      <div className="absolute inset-0 overflow-hidden bg-black">
        {/* AKA-style dark corners - creates floating depth */}
        <div
          className="absolute inset-0 pointer-events-none z-20"
          style={{
            background: `
              linear-gradient(to bottom right, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 12%, transparent 35%),
              linear-gradient(to bottom left, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 12%, transparent 35%),
              linear-gradient(to top right, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 12%, transparent 40%),
              linear-gradient(to top left, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 12%, transparent 40%)
            `,
            }}
        />
        {/* Inner shadow edge for floating effect */}
        <div
          className="absolute inset-0 pointer-events-none z-20"
          style={{
            boxShadow: 'inset 0 0 80px 30px rgba(0,0,0,0.5), inset 0 0 160px 60px rgba(0,0,0,0.25)',
            }}
        />

        {/* Pulsing glow behind the oval - smooth organic breathing */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ opacity: 0.2 }}
        >
          <div
            className="w-[70vw] h-[50vh] rounded-[50%] blur-3xl"
            style={{
              background: `radial-gradient(ellipse at center, ${dominantColor}40 0%, ${dominantColor}10 50%, transparent 70%)`,
              }}
          />
        </div>

        {/* Floating board - between square and oval (squircle) */}
        {/* Like a tablet floating in space - intergalactic vibe */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative overflow-hidden shadow-2xl"
            style={{
              width: '75vw',
              height: '44vw', // Wider and slimmer
              maxHeight: '38vh',
              borderRadius: '42%', // Smoother edges - between square and oval
              boxShadow: `0 0 80px ${dominantColor}25, 0 0 160px ${dominantColor}10`,
              opacity: imageLoaded ? 1 : 0,
              transform: isPlaying ? 'scale(1.015)' : 'scale(1)',
              transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
          >
            {thumbnail ? (
              <SmartImage
                src={thumbnail}
                alt="Album art"
                trackId={trackId}
                className="w-full h-full object-cover"
                onLoad={() => setImageLoaded(true)}
                lazy={false}
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-purple-900 to-pink-900 flex items-center justify-center">
                <Disc3 className="w-20 h-20 text-white/30" />
              </div>
            )}

            {/* Inner glow on oval */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.4) 100%)',
                }}
            />
          </div>
        </div>

        {/* Track type indicator */}
        {isActive && (
          <div
            className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-sm"
          >
            <Music2 className="w-3 h-3 text-purple-400" />
            <span className="text-white/90 text-xs font-medium">Audio</span>
            {isPlaying && (
              <div
                className="w-2 h-2 rounded-full bg-green-500"
              />
            )}
          </div>
        )}
      </div>
    );
  }

  // ============================================
  // CD DISC MODE - Circular vinyl/CD floating
  // ============================================
  if (displayMode === 'disc') {
    return (
      <div className="absolute inset-0 overflow-hidden bg-black">
        {/* AKA-style dark corners - creates floating depth */}
        <div
          className="absolute inset-0 pointer-events-none z-20"
          style={{
            background: `
              linear-gradient(to bottom right, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 12%, transparent 35%),
              linear-gradient(to bottom left, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 12%, transparent 35%),
              linear-gradient(to top right, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 12%, transparent 40%),
              linear-gradient(to top left, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 12%, transparent 40%)
            `,
            }}
        />
        {/* Inner shadow edge for floating effect */}
        <div
          className="absolute inset-0 pointer-events-none z-20"
          style={{
            boxShadow: 'inset 0 0 80px 30px rgba(0,0,0,0.5), inset 0 0 160px 60px rgba(0,0,0,0.25)',
            }}
        />

        {/* Pulsing glow behind the disc - smooth organic breathing */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ opacity: 0.2 }}
        >
          <div
            className="w-[70vw] h-[70vw] rounded-full blur-3xl"
            style={{
              background: `radial-gradient(circle at center, ${dominantColor}40 0%, ${dominantColor}10 50%, transparent 70%)`,
              }}
          />
        </div>

        {/* Floating CD disc */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative"
            style={{
              width: '65vw',
              height: '65vw',
              maxWidth: '350px',
              maxHeight: '350px',
              opacity: imageLoaded ? 1 : 0,
              transform: isPlaying ? 'scale(1.02)' : 'scale(1)',
              transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
          >
            {/* Outer disc ring */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `linear-gradient(135deg, #1a1a1a 0%, #333 50%, #1a1a1a 100%)`,
                boxShadow: `0 0 60px ${dominantColor}30, 0 0 120px ${dominantColor}15, inset 0 0 30px rgba(0,0,0,0.5)`,
                }}
            />

            {/* Album art in center (smaller than full disc) */}
            <div
              className="absolute rounded-full overflow-hidden"
              style={{
                top: '15%',
                left: '15%',
                right: '15%',
                bottom: '15%',
                }}
            >
              {thumbnail ? (
                <SmartImage
                  src={thumbnail}
                  alt="Album art"
                  trackId={trackId}
                  className="w-full h-full object-cover"
                  onLoad={() => setImageLoaded(true)}
                  lazy={false}
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-purple-900 to-pink-900" />
              )}
            </div>

            {/* Center hole */}
            <div
              className="absolute rounded-full bg-black"
              style={{
                top: '46%',
                left: '46%',
                width: '8%',
                height: '8%',
                boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.1)',
                }}
            />

            {/* Vinyl grooves overlay */}
            <div
              className="absolute inset-0 rounded-full pointer-events-none opacity-20"
              style={{
                background: `repeating-radial-gradient(circle at center, transparent 0px, transparent 2px, rgba(255,255,255,0.03) 3px, transparent 4px)`,
                }}
            />
          </div>
        </div>

        {/* Track type indicator */}
        {isActive && (
          <div
            className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-sm"
          >
            <Disc3 className="w-3 h-3 text-purple-400" />
            <span className="text-white/90 text-xs font-medium">Audio</span>
            {isPlaying && (
              <div
                className="w-2 h-2 rounded-full bg-green-500"
              />
            )}
          </div>
        )}
      </div>
    );
  }

  // ============================================
  // FULLSCREEN MODE - Zoomed album art fills viewport
  // ============================================
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {/* Full-screen zoomed album art - fills the viewport */}
      <div className="absolute inset-0 flex items-center justify-center">
        {thumbnail ? (
          <div
            className="min-w-full min-h-full"
            style={{
              width: '120%',
              height: '120%',
              opacity: imageLoaded ? 1 : 0,
              transform: 'scale(1.05)',
              transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <SmartImage
              src={thumbnail}
              alt="Album art"
              trackId={trackId}
              className="w-full h-full object-cover"
              onLoad={() => setImageLoaded(true)}
              lazy={false}
            />
          </div>
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-purple-900 to-pink-900 flex items-center justify-center">
            <Disc3 className="w-32 h-32 text-white/30" />
          </div>
        )}
      </div>

      {/* Subtle color overlay that pulses with beat */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at center, ${dominantColor}20 0%, transparent 70%)`,
          opacity: 0.2,
        }}
      />

      {/* AKA-style dark corners - creates floating depth */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background: `
            linear-gradient(to bottom right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 15%, transparent 40%),
            linear-gradient(to bottom left, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 15%, transparent 40%),
            linear-gradient(to top right, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 15%, transparent 45%),
            linear-gradient(to top left, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 15%, transparent 45%)
          `,
          }}
      />

      {/* Inner shadow edge for floating effect */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          boxShadow: 'inset 0 0 100px 40px rgba(0,0,0,0.6), inset 0 0 200px 80px rgba(0,0,0,0.3)',
          }}
      />

      {/* Center vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.5) 100%)',
          }}
      />

      {/* Track type indicator */}
      {isActive && (
        <div
          className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-sm"
        >
          <Music2 className="w-3 h-3 text-purple-400" />
          <span className="text-white/90 text-xs font-medium">Audio</span>
          {isPlaying && (
            <div
              className="w-2 h-2 rounded-full bg-green-500"
            />
          )}
        </div>
      )}
    </div>
  );
};

// ============================================
// COLOR EXTRACTION UTILITY
// ============================================

/**
 * Extract dominant color from image
 * Uses canvas sampling for speed
 */
export const extractDominantColor = async (imageUrl: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve('#a855f7'); // Fallback purple
          return;
        }

        canvas.width = 10;
        canvas.height = 10;
        ctx.drawImage(img, 0, 0, 10, 10);

        const data = ctx.getImageData(0, 0, 10, 10).data;
        let r = 0, g = 0, b = 0, count = 0;

        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }

        r = Math.floor(r / count);
        g = Math.floor(g / count);
        b = Math.floor(b / count);

        resolve(`rgb(${r}, ${g}, ${b})`);
      } catch {
        resolve('#a855f7');
      }
    };
    img.onerror = () => resolve('#a855f7');
    img.src = imageUrl;
  });
};

export default AnimatedArtCard;
