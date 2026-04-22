import { useEffect, useRef, useState } from 'react';
import { usePWA } from '../../hooks/usePWA';
import { IOSInstallSheet } from './IOSInstallSheet';
import { trace } from '../../services/telemetry';

/**
 * Subtle PWA Install Button — bottom-right floating pill.
 *
 * Behaviour:
 *   - Already installed → render nothing.
 *   - Android / desktop Chrome with a deferred beforeinstallprompt → tap fires
 *     the native install flow.
 *   - iOS Safari (no native prompt) → tap opens IOSInstallSheet with Share
 *     → Add to Home Screen instructions.
 */
export function InstallButton() {
  const { isInstallable, isInstalled, install, platform, hasNativePrompt } = usePWA();
  const [iosSheetOpen, setIosSheetOpen] = useState(false);
  const shownLogged = useRef(false);

  // Fire pwa_install_shown once per mount when the pill actually renders.
  useEffect(() => {
    if (isInstalled || !isInstallable) return;
    if (shownLogged.current) return;
    shownLogged.current = true;
    trace('pwa_install_shown', null, { surface: 'pill', platform, has_native_prompt: hasNativePrompt });
  }, [isInstallable, isInstalled, platform, hasNativePrompt]);

  if (isInstalled || !isInstallable) return null;

  const handleClick = async () => {
    trace('pwa_install_clicked', null, { surface: 'pill', platform, has_native_prompt: hasNativePrompt });
    if (platform === 'ios' || !hasNativePrompt) {
      setIosSheetOpen(true);
      trace('pwa_install_sheet_opened', null, { surface: 'pill', platform });
      return;
    }
    const ok = await install();
    trace(ok ? 'pwa_install_accepted' : 'pwa_install_dismissed', null, {
      surface: 'pill',
      platform,
      dismiss_type: ok ? undefined : 'native_cancelled',
    });
  };

  return (
    <>
      <button
        onClick={handleClick}
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

      <IOSInstallSheet open={iosSheetOpen} onClose={() => setIosSheetOpen(false)} platform={platform} />
    </>
  );
}
