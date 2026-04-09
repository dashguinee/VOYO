/**
 * VOYO Boost Button - Lightning Power
 *
 * One button = Download HD + Audio Enhancement
 * Lightning bolt glows when boosted, pulses when charging
 *
 * Variants:
 * - toolbar: Matches RightToolbar button style (40x40, fits with Like/Settings)
 * - floating: Standalone ergonomic thumb position
 * - mini: Compact for tight spaces
 * - inline: Text + icon horizontal
 */

import { useState, useEffect, useRef } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { useDownloadStore } from '../../store/downloadStore';
import { getThumbnailUrl } from '../../utils/imageHelpers';
import { devLog } from '../../utils/logger';

interface BoostButtonProps {
  variant?: 'toolbar' | 'floating' | 'mini' | 'inline';
  className?: string;
}

// Preset color configurations
// off (Gray) | boosted (Yellow) | calm (Blue) | voyex (Purple)
const PRESET_COLORS = {
  off: {
    primary: '#6b7280',    // Gray
    secondary: '#4b5563',
    light: '#9ca3af',
    glow: 'rgba(107,114,128,0.3)',
    bg: 'bg-gray-500/20',
    border: 'border-gray-400/40',
    shadow: 'shadow-gray-500/20',
    text: 'text-gray-400',
  },
  boosted: {
    primary: '#8b5cf6',    // Purple (brand)
    secondary: '#7c3aed',
    light: '#a78bfa',
    glow: 'rgba(139,92,246,0.6)',
    bg: 'bg-purple-500/30',
    border: 'border-purple-400/60',
    shadow: 'shadow-purple-500/30',
    text: 'text-purple-400',
  },
  calm: {
    primary: '#D4A053',    // Soft bronze (warm calm)
    secondary: '#C4943D',
    light: '#E0B86E',
    glow: 'rgba(212,160,83,0.6)',
    bg: 'bg-[#D4A053]/30',
    border: 'border-[#D4A053]/60',
    shadow: 'shadow-[#D4A053]/30',
    text: 'text-[#D4A053]',
  },
  voyex: {
    primary: '#8b5cf6',    // Purple (VOYEX = premium energy)
    secondary: '#7c3aed',
    light: '#a78bfa',
    glow: 'rgba(139,92,246,0.6)',
    bg: 'bg-purple-500/30',
    border: 'border-purple-400/60',
    shadow: 'shadow-purple-500/30',
    text: 'text-purple-400',
  },
};

type BoostPreset = 'off' | 'boosted' | 'calm' | 'voyex';

// Clean Lightning Bolt SVG Icon - Color changes based on preset
// outlineOnly mode = stroke, no fill (for R2 server-boosted)
const LightningIcon = ({ isGlowing, isCharging, size = 14, preset = 'boosted', outlineOnly = false }: { isGlowing: boolean; isCharging: boolean; size?: number; preset?: BoostPreset; outlineOnly?: boolean }) => {
  const colors = PRESET_COLORS[preset];
  const gradientId = `lightningGradient-${preset}`;
  const glowId = `lightningGlow-${preset}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="relative"
    >
      {/* Outer glow when boosted (not for outline mode) */}
      {isGlowing && !outlineOnly && (
        <path
          d="M13 2L4 14h7l-2 8 11-12h-7l2-8z"
          fill={`url(#${glowId})`}
          filter="blur(4px)"
          className="animate-voyo-lightning-pulse"
        />
      )}

      {/* Main lightning bolt */}
      <path
        d="M13 2L4 14h7l-2 8 11-12h-7l2-8z"
        fill={outlineOnly ? "none" : (isGlowing ? `url(#${gradientId})` : "#6b6b7a")}
        stroke={outlineOnly ? colors.primary : (isGlowing ? colors.primary : "transparent")}
        strokeWidth={outlineOnly ? "2" : "0.5"}
        className={isCharging ? 'animate-voyo-charging' : outlineOnly ? 'animate-voyo-outline-pulse' : ''}
      />

      {/* Gradients - dynamic based on preset */}
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={colors.light} />
          <stop offset="50%" stopColor={colors.primary} />
          <stop offset="100%" stopColor={colors.secondary} />
        </linearGradient>
        <linearGradient id={glowId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={colors.light} stopOpacity="0.6" />
          <stop offset="100%" stopColor={colors.secondary} stopOpacity="0.3" />
        </linearGradient>
      </defs>
    </svg>
  );
};

// Circular progress ring with priming animation
const ProgressRing = ({ progress, isStarting, size = 44, preset = 'boosted' }: { progress: number; isStarting: boolean; size?: number; preset?: BoostPreset }) => {
  const colors = PRESET_COLORS[preset];
  const ringGradientId = `boostGradient-${preset}`;
  const [phase, setPhase] = useState<'priming' | 'progress'>('priming');
  const [primingRound, setPrimingRound] = useState(0);

  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Handle priming animation (2 full rounds)
  useEffect(() => {
    if (!isStarting) {
      setPhase('priming');
      setPrimingRound(0);
      return;
    }

    if (progress > 10) {
      setPhase('progress');
      return;
    }

    if (phase === 'priming' && primingRound < 2) {
      const timer = setTimeout(() => {
        setPrimingRound(prev => prev + 1);
      }, 400);
      return () => clearTimeout(timer);
    }

    if (primingRound >= 2) {
      setPhase('progress');
    }
  }, [isStarting, progress, phase, primingRound]);

  useEffect(() => {
    if (!isStarting) {
      setPhase('priming');
      setPrimingRound(0);
    }
  }, [isStarting]);

  const getStrokeOffset = () => {
    if (phase === 'priming') {
      return 0;
    }
    return circumference - (circumference * progress) / 100;
  };

  return (
    <svg
      className="absolute inset-0 -rotate-90 pointer-events-none"
      width={size}
      height={size}
      style={{ filter: `drop-shadow(0 0 4px ${colors.glow})` }}
    >
      {/* Background ring (dim) */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={`${colors.primary}26`}
        strokeWidth={strokeWidth}
      />
      {/* Progress ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={`url(#${ringGradientId})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={phase === 'priming' ? 0 : getStrokeOffset()}
        style={{
          transition: phase === 'priming'
            ? 'stroke-dashoffset 0.4s ease-in-out'
            : 'stroke-dashoffset 0.3s ease-out',
        }}
      />
      <defs>
        <linearGradient id={ringGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={colors.light} />
          <stop offset="50%" stopColor={colors.primary} />
          <stop offset="100%" stopColor={colors.secondary} />
        </linearGradient>
      </defs>
    </svg>
  );
};

// Completion burst animation
const CompletionBurst = ({ onComplete, preset = 'boosted' }: { onComplete: () => void; preset?: BoostPreset }) => {
  const colors = PRESET_COLORS[preset];

  useEffect(() => {
    const timer = setTimeout(onComplete, 800);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div
      className="absolute inset-0 rounded-full pointer-events-none animate-voyo-burst"
      style={{ background: `${colors.primary}99` }}
    />
  );
};

// Spark particles when boosting
const BoostSparks = ({ preset = 'boosted' }: { preset?: BoostPreset }) => {
  const colors = PRESET_COLORS[preset];
  const sparksRef = useRef<{ x: number; y: number }[]>(
    [...Array(6)].map(() => ({
      x: (Math.random() - 0.5) * 40,
      y: (Math.random() - 0.5) * 40,
    }))
  );

  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible">
      {sparksRef.current.map((spark, i) => (
        <div
          key={i}
          className="absolute w-1 h-1 rounded-full"
          style={{
            left: '50%',
            top: '50%',
            backgroundColor: colors.primary,
            '--spark-x': `${spark.x}px`,
            '--spark-y': `${spark.y}px`,
            animation: `voyo-spark 0.6s ease-out ${i * 0.1}s infinite`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
};

export const BoostButton = ({ variant = 'toolbar', className = '' }: BoostButtonProps) => {
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const playbackSource = usePlayerStore((state) => state.playbackSource);
  const boostProfile = usePlayerStore((state) => state.boostProfile) as BoostPreset;
  const setBoostProfile = usePlayerStore((state) => state.setBoostProfile);

  const {
    boostTrack,
    getDownloadStatus,
    downloads,
    isTrackBoosted,
    lastBoostCompletion,
  } = useDownloadStore();

  const [isCached, setIsCached] = useState(false);
  const [showSparks, setShowSparks] = useState(false);
  const [showBurst, setShowBurst] = useState(false);
  const [lastActivePreset, setLastActivePreset] = useState<BoostPreset>('boosted');

  const isEqOn = boostProfile !== 'off';
  const activePreset = isEqOn ? boostProfile : lastActivePreset;
  const colors = PRESET_COLORS[activePreset];

  const isServerCached = playbackSource === 'r2';
  const isLocalCached = playbackSource === 'cached';

  useEffect(() => {
    const checkCached = async () => {
      if (!currentTrack?.trackId) {
        setIsCached(false);
        return;
      }
      const cached = await isTrackBoosted(currentTrack.trackId);
      setIsCached(cached);
    };
    checkCached();
  }, [currentTrack?.trackId, isTrackBoosted]);

  useEffect(() => {
    if (!lastBoostCompletion || !currentTrack?.trackId) return;
    const isMatch =
      lastBoostCompletion.trackId === currentTrack.trackId ||
      lastBoostCompletion.trackId === currentTrack.trackId.replace('VOYO_', '');
    if (isMatch) {
      setShowBurst(true);
      setShowSparks(true);
      setTimeout(() => {
        setIsCached(true);
        setShowSparks(false);
      }, 800);
    }
  }, [lastBoostCompletion, currentTrack?.trackId]);

  useEffect(() => {
    if (!currentTrack?.trackId) return;
    const status = downloads.get(currentTrack.trackId);
    if (status?.status === 'complete') {
      setShowBurst(true);
      setShowSparks(true);
      setTimeout(() => {
        setIsCached(true);
        setShowSparks(false);
      }, 800);
    }
  }, [downloads, currentTrack?.trackId]);

  useEffect(() => {
    if (boostProfile !== 'off') {
      setLastActivePreset(boostProfile);
    }
  }, [boostProfile]);

  if (!currentTrack?.trackId) return null;

  const downloadStatus = getDownloadStatus(currentTrack.trackId);
  const isDownloading = downloadStatus?.status === 'downloading';
  const isQueued = downloadStatus?.status === 'queued';
  const progress = downloadStatus?.progress || 0;

  const isActive = isEqOn;
  const showOutline = isEqOn && !isCached;
  const showFilled = isEqOn && isCached;

  const handleTap = () => {
    if (isDownloading || isQueued) return;

    if (!isCached) {
      devLog('[Boost] Downloading to local cache...');
      setShowSparks(true);
      boostTrack(
        currentTrack.trackId,
        currentTrack.title,
        currentTrack.artist,
        currentTrack.duration || 0,
        getThumbnailUrl(currentTrack.trackId, 'medium')
      );
    } else if (isEqOn) {
      devLog('[Boost] OFF - Raw audio');
      setBoostProfile('off');
    } else {
      devLog(`[Boost] ON - ${lastActivePreset} mode`);
      setBoostProfile(lastActivePreset);
      setShowSparks(true);
      setTimeout(() => setShowSparks(false), 600);
    }
  };

  // TOOLBAR VARIANT
  if (variant === 'toolbar') {
    const getTitle = () => {
      if (isDownloading) return `Downloading ${progress}%`;
      if (showOutline) return 'Boosted (tap to download)';
      if (showFilled) return `${activePreset.charAt(0).toUpperCase() + activePreset.slice(1)} (tap for raw)`;
      return 'Raw audio (tap for boost)';
    };

    return (
      <button
        onClick={handleTap}
        className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-md shadow-lg transition-all duration-300 relative voyo-hover-lift voyo-tap-scale ${
          showOutline
            ? `border-2 ${colors.border}`
            : showFilled
              ? `${colors.bg} border ${colors.border} ${colors.shadow}`
              : 'border border-[#28282f] hover:border-white/20'
        } ${className}`}
        style={!showFilled ? { background: 'rgba(28, 28, 35, 0.65)' } : undefined}
        title={getTitle()}
      >
        {/* Glow effect when EQ is ON */}
        {isEqOn && (
          <div
            className="absolute inset-0 rounded-full blur-md -z-10 animate-voyo-glow-breathe"
            style={{ backgroundColor: `${colors.primary}33` }}
          />
        )}

        {showBurst && <CompletionBurst onComplete={() => setShowBurst(false)} preset={activePreset} />}
        {(isDownloading || isQueued) && <ProgressRing progress={progress} isStarting={isDownloading || isQueued} size={44} preset={activePreset} />}

        <LightningIcon
          isGlowing={isEqOn}
          isCharging={isDownloading || isQueued}
          size={16}
          preset={isEqOn ? activePreset : 'off'}
          outlineOnly={showOutline}
        />
        {showSparks && <BoostSparks preset={activePreset} />}
      </button>
    );
  }

  // FLOATING VARIANT
  if (variant === 'floating') {
    return (
      <button
        onClick={handleTap}
        className={`relative animate-voyo-scale-in voyo-hover-scale voyo-tap-scale ${className}`}
      >
        {isEqOn && (
          <div
            className="absolute inset-0 rounded-full animate-voyo-glow-breathe"
            style={{ background: `radial-gradient(circle, ${colors.primary}4D 0%, transparent 70%)`, filter: 'blur(8px)' }}
          />
        )}
        <div className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${
          isEqOn ? `bg-gradient-to-br ${colors.bg.replace('/30', '/20')} border ${colors.border.replace('/60', '/40')}` : 'bg-white/5 border border-white/10 hover:bg-white/10'
        }`}>
          {(isDownloading || isQueued) && (
            <svg className="absolute inset-0 w-full h-full -rotate-90">
              <circle cx="24" cy="24" r="22" fill="none" stroke={`${colors.primary}33`} strokeWidth="2" />
              <circle
                cx="24" cy="24" r="22" fill="none" stroke={colors.primary} strokeWidth="2"
                strokeLinecap="round" strokeDasharray={138}
                strokeDashoffset={138 - (138 * progress) / 100}
                style={{ transition: 'stroke-dashoffset 0.3s ease-out' }}
              />
            </svg>
          )}
          <LightningIcon isGlowing={isEqOn} isCharging={isDownloading || isQueued} size={20} preset={isEqOn ? activePreset : 'off'} />
          {showSparks && <BoostSparks preset={activePreset} />}
        </div>
      </button>
    );
  }

  // MINI VARIANT
  if (variant === 'mini') {
    return (
      <button
        onClick={handleTap}
        className={`relative w-8 h-8 rounded-full flex items-center justify-center voyo-hover-scale voyo-tap-scale ${isEqOn ? colors.bg.replace('/30', '/20') : 'bg-white/5 hover:bg-white/10'} ${className}`}
      >
        <LightningIcon isGlowing={isEqOn} isCharging={isDownloading} size={12} preset={isEqOn ? activePreset : 'off'} />
      </button>
    );
  }

  // INLINE VARIANT
  return (
    <button
      onClick={handleTap}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full voyo-tap-scale ${isEqOn ? `${colors.bg.replace('/30', '/10')} border ${colors.border.replace('/60', '/30')}` : 'bg-white/5 border border-white/10 hover:bg-white/10'} ${className}`}
    >
      <LightningIcon isGlowing={isEqOn} isCharging={isDownloading} size={14} preset={isEqOn ? activePreset : 'off'} />
      <span className={`text-xs font-medium ${isEqOn ? colors.text : 'text-white/60'}`}>
        {isEqOn ? activePreset.charAt(0).toUpperCase() + activePreset.slice(1) : 'Raw'}
      </span>
    </button>
  );
};

export default BoostButton;
