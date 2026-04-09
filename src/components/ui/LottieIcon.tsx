/**
 * LottieIcon - Lightweight animated icon using CSS animations
 *
 * BATTERY FIX: Replaced lottie-react (307KB vendor chunk) with pure CSS animations.
 * Lottie was only used for 3 simple icons (fire, sunrise, night) — emoji + CSS
 * pulse achieves the same visual effect at zero bundle cost.
 */

interface LottieIconProps {
  lottieUrl?: string;
  fallbackEmoji: string;
  size?: number;
  className?: string;
  loop?: boolean;
  autoplay?: boolean;
  speed?: number;
}

export function LottieIcon({
  fallbackEmoji,
  size = 48,
  className = '',
  loop = true,
  speed = 1,
}: LottieIconProps) {
  // CSS animation duration inversely proportional to speed
  const animDuration = loop ? `${2 / speed}s` : '0s';

  return (
    <span
      className={className}
      style={{
        fontSize: size * 0.8,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        animation: loop ? `voyo-lottie-pulse ${animDuration} ease-in-out infinite` : 'none',
      }}
    >
      {fallbackEmoji}
    </span>
  );
}

export default LottieIcon;
