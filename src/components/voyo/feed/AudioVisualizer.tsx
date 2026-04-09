/**
 * Audio Visualizer Overlay for Feed Cards
 *
 * Creates animated bars that react to music playback
 * Uses CSS animations synced to isPlaying state
 * Lightweight - no actual audio analysis needed
 */

import { useMemo } from 'react';

interface AudioVisualizerProps {
  isPlaying: boolean;
  intensity?: number; // 0-1, affects animation speed/height
  barCount?: number;
  position?: 'bottom' | 'center' | 'full';
  color?: string;
}

export const AudioVisualizer = ({
  isPlaying,
  intensity = 0.7,
  barCount = 32,
  position = 'bottom',
  color = 'rgba(168, 85, 247, 0.8)', // Purple
}: AudioVisualizerProps) => {
  // Generate random but consistent bar heights for each bar
  const bars = useMemo(() => {
    return Array.from({ length: barCount }, (_, i) => ({
      id: i,
      baseHeight: 0.2 + Math.random() * 0.3, // 20-50% base
      maxHeight: 0.5 + Math.random() * 0.5, // 50-100% max
      delay: Math.random() * 0.5, // 0-0.5s delay
    }));
  }, [barCount]);

  const containerClass = position === 'bottom'
    ? 'absolute bottom-0 left-0 right-0 h-24 pointer-events-none'
    : position === 'center'
    ? 'absolute inset-0 flex items-center pointer-events-none'
    : 'absolute inset-0 pointer-events-none';

  return (
    <div className={containerClass}>
      {/* Gradient fade for bottom position */}
      {position === 'bottom' && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
      )}

      {/* Bars container */}
      <div
        className={`flex items-end justify-center gap-[2px] ${
          position === 'bottom' ? 'h-full px-4 pb-2' :
          position === 'center' ? 'h-32 px-8' :
          'h-full px-2'
        }`}
      >
        {bars.map((bar) => (
          <div
            key={bar.id}
            className="rounded-full"
            style={{
              width: `${100 / barCount - 1}%`,
              maxWidth: '8px',
              minWidth: '2px',
              background: `linear-gradient(to top, ${color}, ${color.replace('0.8', '0.4')})`,
              boxShadow: isPlaying ? `0 0 8px ${color}` : 'none',
              height: isPlaying
                ? `${bar.maxHeight * 100 * intensity}%`
                : `${bar.baseHeight * 50}%`,
              opacity: isPlaying ? 0.8 : 0.3,
              }}
          />
        ))}
      </div>
    </div>
  );
};

/**
 * Circular Audio Visualizer - for centered/artistic display
 */
export const CircularVisualizer = ({
  isPlaying,
  size = 120,
  color = 'rgba(168, 85, 247, 0.8)',
}: {
  isPlaying: boolean;
  size?: number;
  color?: string;
}) => {
  const ringCount = 3;

  return (
    <div
      className="relative pointer-events-none"
      style={{ width: size, height: size }}
    >
      {Array.from({ length: ringCount }, (_, i) => {
        const ringSize = size - (i * 20);
        const delay = i * 0.15;

        return (
          <div
            key={i}
            className="absolute rounded-full border-2"
            style={{
              width: ringSize,
              height: ringSize,
              left: (size - ringSize) / 2,
              top: (size - ringSize) / 2,
              borderColor: color,
              transform: isPlaying ? 'scale(1.05)' : 'scale(1)',
              opacity: isPlaying ? 0.5 : 0.2,
              }}
          />
        );
      })}

      {/* Center pulse */}
      <div
        className="absolute rounded-full"
        style={{
          width: size * 0.3,
          height: size * 0.3,
          left: size * 0.35,
          top: size * 0.35,
          background: `radial-gradient(circle, ${color}, transparent)`,
          transform: isPlaying ? 'scale(1)' : 'scale(0.8)',
          opacity: isPlaying ? 0.7 : 0.3,
          }}
      />
    </div>
  );
};

/**
 * Waveform Visualizer - horizontal wave effect
 */
export const WaveformVisualizer = ({
  isPlaying,
  color = 'rgba(236, 72, 153, 0.8)', // Pink
}: {
  isPlaying: boolean;
  color?: string;
}) => {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Multiple wave layers */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="absolute bottom-0 left-0 right-0 h-16"
          style={{
            background: `linear-gradient(to top, ${color.replace('0.8', `${0.3 - i * 0.1}`)}, transparent)`,
            transform: isPlaying ? 'scaleY(1.1)' : 'scaleY(1)',
            }}
        />
      ))}
    </div>
  );
};

export default AudioVisualizer;
