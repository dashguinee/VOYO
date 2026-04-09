import { usePWA } from '../../hooks/usePWA';

/**
 * Subtle PWA Install Button
 * Shows only when app is installable, positioned discretely
 */
export function InstallButton() {
  const { isInstallable, isInstalled, install } = usePWA();

  // Don't render if already installed or not installable
  if (isInstalled || !isInstallable) return null;

  return (
    <button
      onClick={install}
      className="fixed bottom-24 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-full backdrop-blur-md animate-voyo-fade-in-delayed voyo-tap-scale voyo-hover-scale"
      style={{
        background: 'linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(124,58,237,0.2) 100%)',
        border: '1px solid rgba(139,92,246,0.3)',
        boxShadow: '0 4px 20px rgba(139,92,246,0.15)',
      }}
      aria-label="Install VOYO app"
    >
      {/* VOYO Logo Icon */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 192 192"
        className="flex-shrink-0"
      >
        <defs>
          <linearGradient id="installGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{ stopColor: '#8b5cf6' }}/>
            <stop offset="100%" style={{ stopColor: '#7c3aed' }}/>
          </linearGradient>
        </defs>
        <path
          d="M56 50 L96 130 L136 50"
          fill="none"
          stroke="url(#installGrad)"
          strokeWidth="20"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="96" cy="145" r="8" fill="url(#installGrad)"/>
      </svg>

      {/* Text */}
      <span
        className="text-xs font-medium whitespace-nowrap"
        style={{
          background: 'linear-gradient(90deg, #8b5cf6, #a78bfa)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
      >
        Install App
      </span>

      {/* Download arrow icon */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        className="flex-shrink-0 opacity-60"
      >
        <path
          d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16"
          stroke="#a855f7"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
