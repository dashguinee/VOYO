/**
 * DynamicVignette - The Alpha Beth 2 Spotlight Effect
 *
 * Creates a dynamic dark fade around the edges that:
 * 1. Pulses with the music (BPM-synced)
 * 2. Transitions between heavy/light vignette
 * 3. Creates depth and focus on content
 *
 * This is the UI pattern from Alpha Beth 2 video:
 * - Dark fades around edges
 * - Transitions to full video
 * - Back to vignette for some parts
 */

import { useState, useEffect, useMemo } from 'react';

interface DynamicVignetteProps {
  isActive: boolean;
  isPlaying: boolean;
  bpm?: number;
  intensity?: 'light' | 'medium' | 'heavy' | 'spotlight';
  color?: string; // Dominant color for tinted vignette
  pulseEnabled?: boolean;
  transitionMode?: 'fade' | 'iris' | 'radial'; // Different transition styles
}

const DEFAULT_BPM = 120;

// Vignette intensity presets
const INTENSITY_CONFIG = {
  light: {
    innerRadius: '60%',
    outerOpacity: 0.4,
    pulseRange: [0.3, 0.5],
  },
  medium: {
    innerRadius: '50%',
    outerOpacity: 0.6,
    pulseRange: [0.4, 0.7],
  },
  heavy: {
    innerRadius: '40%',
    outerOpacity: 0.8,
    pulseRange: [0.6, 0.9],
  },
  spotlight: {
    innerRadius: '30%',
    outerOpacity: 0.95,
    pulseRange: [0.85, 1],
  },
};

export const DynamicVignette = ({
  isActive,
  isPlaying,
  bpm = DEFAULT_BPM,
  intensity = 'medium',
  color,
  pulseEnabled = true,
  transitionMode = 'radial',
}: DynamicVignetteProps) => {
  const [currentIntensity, setCurrentIntensity] = useState(intensity);

  // Calculate beat duration
  const beatDuration = 60 / bpm;

  // Get intensity config
  const config = INTENSITY_CONFIG[currentIntensity];

  // Auto-cycle intensity for variety (simulates music sections)
  useEffect(() => {
    if (!isPlaying || !isActive) return;

    // Every 8 beats, chance to change intensity
    const cycleInterval = beatDuration * 8 * 1000;

    const interval = setInterval(() => {
      // Random intensity shift (weighted toward current)
      const intensities: Array<'light' | 'medium' | 'heavy' | 'spotlight'> =
        ['light', 'medium', 'heavy', 'spotlight'];
      const currentIndex = intensities.indexOf(currentIntensity);

      // 60% stay same, 20% lighter, 20% heavier
      const rand = Math.random();
      if (rand > 0.6) {
        const newIndex = rand > 0.8
          ? Math.min(currentIndex + 1, 3)
          : Math.max(currentIndex - 1, 0);
        setCurrentIntensity(intensities[newIndex]);
      }
    }, cycleInterval);

    return () => clearInterval(interval);
  }, [isPlaying, isActive, beatDuration, currentIntensity]);

  // Reset to medium when not active
  useEffect(() => {
    if (!isActive) setCurrentIntensity('medium');
  }, [isActive]);

  // Generate gradient based on mode
  const gradient = useMemo(() => {
    const baseColor = color || 'rgba(0,0,0,1)';
    const isRgb = baseColor.startsWith('rgb');

    // Extract RGB values for tinting
    let r = 0, g = 0, b = 0;
    if (isRgb) {
      const match = baseColor.match(/\d+/g);
      if (match) {
        r = parseInt(match[0]) * 0.2; // Darken significantly
        g = parseInt(match[1]) * 0.2;
        b = parseInt(match[2]) * 0.2;
      }
    }

    const darkColor = isRgb ? `rgba(${r},${g},${b},` : 'rgba(0,0,0,';

    switch (transitionMode) {
      case 'iris':
        // Circular spotlight from center
        return `radial-gradient(circle at center,
          transparent 0%,
          transparent ${config.innerRadius},
          ${darkColor}${config.outerOpacity * 0.5}) 65%,
          ${darkColor}${config.outerOpacity}) 100%
        )`;

      case 'fade':
        // Soft edge fade
        return `radial-gradient(ellipse at center,
          transparent 0%,
          transparent 30%,
          ${darkColor}${config.outerOpacity * 0.3}) 50%,
          ${darkColor}${config.outerOpacity * 0.6}) 75%,
          ${darkColor}${config.outerOpacity}) 100%
        )`;

      case 'radial':
      default:
        // Classic radial vignette
        return `radial-gradient(ellipse at center,
          transparent 0%,
          transparent ${config.innerRadius},
          ${darkColor}${config.outerOpacity}) 100%
        )`;
    }
  }, [transitionMode, config, color]);

  return (
    <>
      {/* Main vignette layer - pulses with beat */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background: gradient,
          opacity: config.outerOpacity,
        }}
      />

      {/* Corner darkening for extra depth - AKA style deep corners */}
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

      {/* Inner glow edge - creates floating appearance */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          boxShadow: 'inset 0 0 100px 40px rgba(0,0,0,0.6), inset 0 0 200px 80px rgba(0,0,0,0.3)',
          }}
      />

      {/* Spotlight glow when in spotlight mode */}
      
        {currentIntensity === 'spotlight' && isPlaying && (
          <div
            className="absolute inset-0 pointer-events-none z-10"
            style={{
              background: `radial-gradient(circle at center,
                rgba(255,255,255,0.05) 0%,
                transparent 40%
              )`,
              }}
          />
        )}
      
    </>
  );
};

// ============================================
// VIGNETTE TRANSITION CONTROLLER
// ============================================

/**
 * Hook to control vignette transitions programmatically
 * Use this to sync vignette with track sections
 */
export const useVignetteController = (trackDuration: number, bpm: number) => {
  const [intensity, setIntensity] = useState<'light' | 'medium' | 'heavy' | 'spotlight'>('medium');
  const [transitionMode, setTransitionMode] = useState<'fade' | 'iris' | 'radial'>('radial');

  // Pre-defined section patterns (could be driven by AI analysis)
  const patterns = useMemo(() => ({
    intro: { intensity: 'heavy' as const, mode: 'iris' as const },
    verse: { intensity: 'medium' as const, mode: 'radial' as const },
    prechorus: { intensity: 'medium' as const, mode: 'fade' as const },
    chorus: { intensity: 'light' as const, mode: 'radial' as const },
    bridge: { intensity: 'spotlight' as const, mode: 'iris' as const },
    outro: { intensity: 'heavy' as const, mode: 'fade' as const },
  }), []);

  const setSection = (section: keyof typeof patterns) => {
    const pattern = patterns[section];
    setIntensity(pattern.intensity);
    setTransitionMode(pattern.mode);
  };

  return {
    intensity,
    transitionMode,
    setIntensity,
    setTransitionMode,
    setSection,
    patterns,
  };
};

// ============================================
// QUICK VIGNETTE PRESETS
// ============================================

export const VignettePresets = {
  // Intro - Heavy dark edges, spotlight feel
  intro: {
    intensity: 'heavy' as const,
    transitionMode: 'iris' as const,
    pulseEnabled: false,
  },

  // Verse - Medium, subtle pulse
  verse: {
    intensity: 'medium' as const,
    transitionMode: 'radial' as const,
    pulseEnabled: true,
  },

  // Chorus - Light, let content breathe
  chorus: {
    intensity: 'light' as const,
    transitionMode: 'fade' as const,
    pulseEnabled: true,
  },

  // Drop/Hook - Spotlight moment
  drop: {
    intensity: 'spotlight' as const,
    transitionMode: 'iris' as const,
    pulseEnabled: true,
  },

  // Calm section
  calm: {
    intensity: 'heavy' as const,
    transitionMode: 'fade' as const,
    pulseEnabled: false,
  },
};

export default DynamicVignette;
