/**
 * VOYO Music - Buffer Health Indicator
 *
 * Smart visual indicator for buffer status during cached playback
 * Uses audioEngine's buffer health monitoring
 *
 * Visual States:
 * - Healthy (>80%): Green glow, subtle pulse
 * - Warning (30-80%): Yellow glow, visible pulse
 * - Emergency (<30%): Red glow, rapid pulse
 * - Hidden when iframe playback (not needed)
 */

import React from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { Wifi } from 'lucide-react';

interface BufferHealthIndicatorProps {
  className?: string;
  compact?: boolean;
}

export const BufferHealthIndicator: React.FC<BufferHealthIndicatorProps> = ({
  className = '',
  compact = false,
}) => {
  // Battery fix: fine-grained selectors
  const bufferHealth = usePlayerStore(s => s.bufferHealth);
  const bufferStatus = usePlayerStore(s => s.bufferStatus);
  const playbackSource = usePlayerStore(s => s.playbackSource);

  // Only show for cached playback (iframe handles its own buffering)
  if (playbackSource !== 'cached') {
    return null;
  }

  // Color coding based on status
  const getStatusColor = () => {
    switch (bufferStatus) {
      case 'healthy':
        return '#10b981'; // Green
      case 'warning':
        return '#f59e0b'; // Yellow/Orange
      case 'emergency':
        return '#ef4444'; // Red
      default:
        return '#6b7280'; // Gray
    }
  };

  // Animation intensity based on status
  const getAnimationClass = () => {
    switch (bufferStatus) {
      case 'healthy':
        return 'animate-pulse-slow'; // Subtle
      case 'warning':
        return 'animate-pulse'; // Normal
      case 'emergency':
        return 'animate-pulse-fast'; // Rapid
      default:
        return '';
    }
  };

  const statusColor = getStatusColor();

  return (
    <div
      className={`flex items-center gap-2 ${className}`}
      style={{
        opacity: bufferStatus === 'healthy' ? 0.6 : 1,
        transition: 'opacity 0.3s ease',
      }}
    >
      {/* Buffer icon with status color */}
      <div className="relative">
        <Wifi
          size={compact ? 14 : 16}
          className={getAnimationClass()}
          style={{
            color: statusColor,
            filter: `drop-shadow(0 0 6px ${statusColor}40)`,
          }}
        />

        {/* Progress ring (only show when buffering) */}
        {bufferStatus !== 'healthy' && !compact && (
          <svg
            className="absolute -inset-1"
            width="24"
            height="24"
            style={{
              transform: 'rotate(-90deg)',
            }}
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              fill="none"
              stroke={statusColor}
              strokeWidth="2"
              strokeDasharray={`${(bufferHealth / 100) * 62.8} 62.8`}
              opacity="0.3"
            />
          </svg>
        )}
      </div>

      {/* Buffer percentage (compact mode hides this) */}
      {!compact && bufferStatus !== 'healthy' && (
        <span
          className="text-xs font-medium tabular-nums"
          style={{
            color: statusColor,
          }}
        >
          {bufferHealth}%
        </span>
      )}
    </div>
  );
};

// Add custom animation for slower pulse
const style = document.createElement('style');
style.textContent = `
  @keyframes pulse-slow {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  @keyframes pulse-fast {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .animate-pulse-slow {
    animation: pulse-slow 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  .animate-pulse-fast {
    animation: pulse-fast 0.8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
`;
document.head.appendChild(style);
