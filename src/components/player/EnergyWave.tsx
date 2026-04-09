/**
 * VOYO ENERGY WAVE - Animated Progress Bar
 *
 * Replaces boring progress bars with an animated waveform visualization.
 * Features:
 * - 40 vertical bars creating a horizontal waveform (20 on mobile for performance)
 * - Bars pulse/animate based on generated "energy" pattern
 * - Current position shown with bright glow/highlight
 * - Tap anywhere to seek to that position
 * - Time display: current / total
 * - Gradient: purple → pink (VOYO brand)
 *
 * MOBILE OPTIMIZATIONS (Dec 2025):
 * - Reduced bar count on mobile (20 vs 40)
 * - CSS animations instead of Framer Motion for pulses
 * - Respects prefers-reduced-motion
 * - Uses will-change hints for GPU acceleration
 */

import { useRef, useMemo, useState, useEffect } from 'react';
import { usePlayerStore } from '../../store/playerStore';

// Detect mobile and reduced motion preferences
const useMediaQueries = () => {
  const [isMobile, setIsMobile] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Check mobile
    const checkMobile = () => setIsMobile(window.innerWidth < 768 || 'ontouchstart' in window);
    checkMobile();
    window.addEventListener('resize', checkMobile);

    // Check reduced motion
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(motionQuery.matches);
    const handleMotionChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    motionQuery.addEventListener('change', handleMotionChange);

    return () => {
      window.removeEventListener('resize', checkMobile);
      motionQuery.removeEventListener('change', handleMotionChange);
    };
  }, []);

  return { isMobile, prefersReducedMotion };
};

interface EnergyWaveProps {
  className?: string;
}

// Generate consistent wave pattern from track ID
const generateWavePattern = (trackId: string, barCount: number): number[] => {
  // Use track ID as seed for consistent patterns
  const seed = trackId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

  const pattern: number[] = [];
  let lcg = seed; // Linear Congruential Generator

  for (let i = 0; i < barCount; i++) {
    lcg = (lcg * 1103515245 + 12345) & 0x7fffffff;
    const normalized = (lcg / 0x7fffffff);

    // Create wave-like pattern with smooth transitions
    const waveBase = Math.sin((i / barCount) * Math.PI * 3) * 0.3 + 0.5;
    const randomVariation = normalized * 0.4;
    const height = Math.max(0.2, Math.min(1, waveBase + randomVariation));

    pattern.push(height);
  }

  return pattern;
};

// Format time in mm:ss
const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const EnergyWave = ({ className = '' }: EnergyWaveProps) => {
  // Battery fix: fine-grained selectors — progress updates ~60fps, only re-render what's needed
  const progress = usePlayerStore(s => s.progress);
  const currentTime = usePlayerStore(s => s.currentTime);
  const duration = usePlayerStore(s => s.duration);
  const seekTo = usePlayerStore(s => s.seekTo);
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const { isMobile, prefersReducedMotion } = useMediaQueries();

  // MOBILE OPTIMIZATION: Reduce bar count for better performance
  const BAR_COUNT = isMobile ? 20 : 40;

  // Generate wave pattern based on current track
  const wavePattern = useMemo(() => {
    if (!currentTrack) return Array(BAR_COUNT).fill(0.5);
    return generateWavePattern(currentTrack.id, BAR_COUNT);
  }, [currentTrack?.id]);

  // Handle click/tap to seek
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || !duration) return;

    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = (clickX / rect.width) * 100;
    const newTime = (percentage / 100) * duration;

    seekTo(newTime);
  };

  // Calculate which bar represents current position
  const currentBarIndex = Math.floor((progress / 100) * BAR_COUNT);

  return (
    <div className={`flex flex-col items-center gap-3 w-full ${className}`}>

      {/* Time Display */}
      <div className="flex justify-between w-full px-4 text-[10px] font-mono text-gray-500">
        <span className="text-purple-400 font-bold">{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>

      {/* Wave Container */}
      <div
        ref={containerRef}
        className="relative w-full h-12 flex items-end gap-[2px] cursor-pointer px-2"
        onClick={handleSeek}
        onMouseMove={(e) => {
          if (!containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const barIndex = Math.floor((mouseX / rect.width) * BAR_COUNT);
          setHoveredBar(barIndex);
        }}
        onMouseLeave={() => setHoveredBar(null)}
      >
        {wavePattern.map((height, index) => {
          const isPlayed = index <= currentBarIndex;
          const isCurrent = index === currentBarIndex;
          const isHovered = index === hoveredBar;

          // Bar height (scaled)
          const barHeight = height * 100;

          // MOBILE OPTIMIZATION: Use CSS animations instead of Framer Motion for infinite loops
          // Only use Framer Motion for entrance animation
          return (
            <div
              key={index}
              className="flex-1 rounded-t-full relative"
              style={{
                height: `${barHeight}%`,
                minHeight: '20%',
                // GPU acceleration hint
                willChange: 'transform',
                transform: 'translateZ(0)',
                }}
            >
              {/* Bar Background - CSS animation for pulse */}
              <div
                className={`
                  absolute inset-0 rounded-t-full transition-all duration-200
                  ${isPlayed
                    ? 'bg-gradient-to-t from-purple-500 to-violet-400'
                    : 'bg-gradient-to-t from-gray-700 to-gray-600'
                  }
                  ${isCurrent ? 'brightness-150' : ''}
                  ${isHovered ? 'brightness-125' : ''}
                  ${isPlayed && !prefersReducedMotion ? 'animate-wave-pulse' : ''}
                `}
                style={{
                  animationDelay: `${index * 50}ms`,
                  }}
              />

              {/* Glow Effect on Current Position - CSS animation */}
              {isCurrent && !prefersReducedMotion && (
                <div
                  className="absolute inset-0 rounded-t-full bg-gradient-to-t from-purple-400 to-white animate-glow-pulse"
                />
              )}

              {/* Shimmer Effect DISABLED on mobile for performance */}
              {isPlayed && !isMobile && !prefersReducedMotion && (
                <div
                  className="absolute inset-0 rounded-t-full bg-gradient-to-t from-transparent via-white/30 to-transparent animate-shimmer"
                  style={{ animationDelay: `${index * 100}ms` }}
                />
              )}

              {/* Hover Indicator - only on desktop */}
              {isHovered && !isPlayed && !isMobile && (
                <div
                  className="absolute inset-0 rounded-t-full bg-gradient-to-t from-purple-400/50 to-violet-300/50 animate-fade-in"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Progress Percentage (subtle) */}
      <div className="text-[8px] font-mono text-gray-600">
        {Math.round(progress)}% energy
      </div>
    </div>
  );
};

export default EnergyWave;
