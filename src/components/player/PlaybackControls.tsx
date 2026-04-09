import React, { useState } from 'react';
import { Shuffle, Repeat, Repeat1, Volume2, VolumeX } from 'lucide-react';
import { usePlayerStore } from '../../store/playerStore';
import { BufferHealthIndicator } from './BufferHealthIndicator';

interface PlaybackControlsProps {
  className?: string;
  compact?: boolean; // true = icons only, false = icons + labels
}

export const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  className = '',
  compact = false,
}) => {
  // Battery fix: fine-grained selectors
  const shuffleMode = usePlayerStore(s => s.shuffleMode);
  const repeatMode = usePlayerStore(s => s.repeatMode);
  const volume = usePlayerStore(s => s.volume);
  const toggleShuffle = usePlayerStore(s => s.toggleShuffle);
  const cycleRepeat = usePlayerStore(s => s.cycleRepeat);
  const setVolume = usePlayerStore(s => s.setVolume);

  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [isShuffleSpinning, setIsShuffleSpinning] = useState(false);

  // Handle shuffle with ROULETTE animation
  const handleShuffleClick = () => {
    if (!shuffleMode) {
      // Activating shuffle - trigger spin animation
      setIsShuffleSpinning(true);
      setTimeout(() => setIsShuffleSpinning(false), 600);
    }
    toggleShuffle();
  };

  // Get repeat icon based on mode
  const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat;

  // Volume icon based on level
  const VolumeIcon = volume === 0 ? VolumeX : Volume2;

  return (
    <div
      className={`flex items-center gap-4 ${className}`}
      style={{
        background: compact ? 'transparent' : 'rgba(255, 255, 255, 0.05)',
        padding: compact ? '0' : '8px 12px',
        borderRadius: '12px',
      }}
    >
      {/* Buffer Health Indicator (only shows for cached playback) */}
      <BufferHealthIndicator compact={compact} />

      {/* Shuffle Button - FIX 2: Touch target 44px */}
      <button
        onClick={handleShuffleClick}
        className="group relative flex items-center gap-2 transition-all duration-300 min-h-[44px] min-w-[44px] justify-center"
        style={{
          color: shuffleMode ? '#a855f7' : '#6b7280',
          filter: shuffleMode ? 'drop-shadow(0 0 8px rgba(168, 85, 247, 0.5))' : 'none',
        }}
        title="Shuffle"
      >
        <Shuffle
          size={20}
          className={`transition-transform duration-600 ${
            isShuffleSpinning ? 'animate-spin-roulette' : ''
          }`}
          style={{
            animation: isShuffleSpinning ? 'spin-roulette 0.6s ease-in-out' : 'none',
          }}
        />
        {!compact && (
          <span
            className="text-xs font-medium"
            style={{ color: shuffleMode ? '#a855f7' : '#9ca3af' }}
          >
            Shuffle
          </span>
        )}
      </button>

      {/* Repeat Button */}
      <button
        onClick={cycleRepeat}
        className="group relative flex items-center gap-2 transition-all duration-300"
        style={{
          color: repeatMode !== 'off' ? '#a855f7' : '#6b7280',
          filter: repeatMode !== 'off' ? 'drop-shadow(0 0 8px rgba(168, 85, 247, 0.5))' : 'none',
        }}
        title={`Repeat: ${repeatMode}`}
      >
        <RepeatIcon size={20} />
        {!compact && (
          <span
            className="text-xs font-medium"
            style={{ color: repeatMode !== 'off' ? '#a855f7' : '#9ca3af' }}
          >
            Repeat {repeatMode !== 'off' ? `(${repeatMode})` : ''}
          </span>
        )}
      </button>

      {/* Volume Control */}
      <div
        className="relative flex items-center gap-2"
        onMouseEnter={() => setShowVolumeSlider(true)}
        onMouseLeave={() => setShowVolumeSlider(false)}
      >
        <button
          onClick={() => {
            // FIX: Toggle slider on mobile (no hover support)
            if (!compact) {
              setShowVolumeSlider(!showVolumeSlider);
            }
            // Also toggle mute
            setVolume(volume === 0 ? 80 : 0);
          }}
          className="transition-colors"
          style={{ color: '#9ca3af' }}
          title={`Volume: ${volume}%`}
        >
          <VolumeIcon size={20} />
        </button>

        {/* Volume Slider */}
        {(showVolumeSlider || !compact) && (
          <div
            className="relative flex items-center"
            style={{
              width: '80px',
              height: '4px',
              background: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '2px',
              cursor: 'pointer',
              transition: 'opacity 0.2s',
              opacity: showVolumeSlider || !compact ? 1 : 0,
            }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
              setVolume(Math.round(percentage));
            }}
            onTouchMove={(e) => {
              // FIX: Support touch drag for mobile
              const touch = e.touches[0];
              const rect = e.currentTarget.getBoundingClientRect();
              const x = touch.clientX - rect.left;
              const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
              setVolume(Math.round(percentage));
            }}
          >
            {/* Volume Fill */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                height: '100%',
                width: `${volume}%`,
                background: 'linear-gradient(90deg, #8b5cf6 0%, #a78bfa 100%)',
                borderRadius: '2px',
                transition: 'width 0.1s',
              }}
            />

            {/* Volume Handle */}
            <div
              style={{
                position: 'absolute',
                left: `${volume}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '12px',
                height: '12px',
                background: '#ffffff',
                borderRadius: '50%',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
                transition: 'left 0.1s',
              }}
            />
          </div>
        )}

        {!compact && (
          <span className="text-xs font-medium" style={{ color: '#9ca3af', minWidth: '32px' }}>
            {volume}%
          </span>
        )}
      </div>
    </div>
  );
};

// FIX 6: Add custom CSS animation for shuffle roulette spin with cleanup
const style = document.createElement('style');
style.setAttribute('data-component', 'playback-controls-roulette');
style.textContent = `
  @keyframes spin-roulette {
    0% {
      transform: rotate(0deg) scale(1);
    }
    50% {
      transform: rotate(180deg) scale(1.2);
    }
    100% {
      transform: rotate(360deg) scale(1);
    }
  }
`;

// Only append if not already present
if (!document.querySelector('style[data-component="playback-controls-roulette"]')) {
  document.head.appendChild(style);
}
