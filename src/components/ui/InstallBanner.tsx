import { useEffect, useState } from 'react';
import { usePWA } from '../../hooks/usePWA';
import { IOSInstallSheet } from './IOSInstallSheet';

// One-time dismissal, 14-day cooldown.
const DISMISS_KEY = 'voyo-install-banner-dismissed-at';
const COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

// Once-per-session guard so navigating inside the app doesn't re-trigger.
const SESSION_KEY = 'voyo-install-banner-seen';

// The GreetingBanner runs fade-in → hold → fade-out = 5.2s. Start at 8s
// so the install moment lands cleanly after the greeting has left the
// stage, not on top of it. Feels like two separate breaths, not one
// noisy arrival.
const SHOW_DELAY_MS = 8000;

function isDismissedRecently(): boolean {
  try {
    const at = localStorage.getItem(DISMISS_KEY);
    if (!at) return false;
    const t = parseInt(at, 10);
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function wasSeenThisSession(): boolean {
  try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch { return false; }
}

function markSeenThisSession() {
  try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* private mode */ }
}

/**
 * Install moment — single, quiet, bottom-center glass card.
 *
 *   - Fires 8s after mount, AFTER the GreetingBanner has fully faded so
 *     the two moments never overlap.
 *   - Once per session + 14-day localStorage cooldown on dismiss.
 *   - No shimmer, no neon, no slide acrobatics — a gentle fade + 6px
 *     rise is the only motion. Premium = restraint.
 *   - Single primary action. Tapping calls native prompt (Android) or
 *     opens the Share-sheet instructions (iOS).
 */
export function InstallBanner() {
  const { isInstallable, isInstalled, install, platform, hasNativePrompt } = usePWA();
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [iosSheetOpen, setIosSheetOpen] = useState(false);

  useEffect(() => {
    if (isInstalled || !isInstallable) {
      setVisible(false);
      return;
    }
    if (wasSeenThisSession() || isDismissedRecently()) return;

    const t = window.setTimeout(() => {
      setVisible(true);
      markSeenThisSession();
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [isInstallable, isInstalled]);

  const dismiss = (remember: boolean) => {
    setLeaving(true);
    window.setTimeout(() => setVisible(false), 400);
    if (remember) {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
    }
  };

  const handleInstall = async () => {
    if (platform === 'ios' || !hasNativePrompt) {
      setIosSheetOpen(true);
      return;
    }
    const ok = await install();
    if (ok) dismiss(false);
  };

  if (!visible) {
    return <IOSInstallSheet open={iosSheetOpen} onClose={() => setIosSheetOpen(false)} platform={platform} />;
  }

  return (
    <>
      <div
        className="fixed left-0 right-0 z-[55] flex justify-center px-4 pointer-events-none"
        style={{
          // Sits above both VoyoBottomNav (~90px with safe-area) AND the
          // bottom-right InstallButton pill (bottom-24 = 96px, ~40px tall).
          // 148px clears the pill with a 12px gap — no vertical collision.
          bottom: 'calc(env(safe-area-inset-bottom) + 148px)',
        }}
      >
        <div
          className="pointer-events-auto w-full max-w-sm rounded-2xl px-4 py-3.5 flex items-center gap-3"
          style={{
            background: 'rgba(15, 12, 24, 0.82)',
            backdropFilter: 'blur(24px) saturate(140%)',
            WebkitBackdropFilter: 'blur(24px) saturate(140%)',
            border: '1px solid rgba(255,255,255,0.06)',
            boxShadow: '0 20px 60px -20px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.04) inset',
            opacity: leaving ? 0 : 1,
            transform: leaving ? 'translateY(6px)' : 'translateY(0)',
            transition: 'opacity 400ms cubic-bezier(0.2, 0.8, 0.2, 1), transform 400ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            animation: leaving ? undefined : 'voyo-install-enter 520ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
        >
          {/* Single signature element: the VOYO mark, unadorned. */}
          <svg width="22" height="22" viewBox="0 0 192 192" className="flex-shrink-0">
            <path
              d="M56 50 L96 130 L136 50"
              fill="none"
              stroke="#a78bfa"
              strokeWidth="20"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="96" cy="145" r="7" fill="#a78bfa"/>
          </svg>

          <div className="flex-1 min-w-0">
            <p
              className="text-[14px] font-medium text-white/95 leading-tight truncate"
              style={{ fontFamily: "'Satoshi', sans-serif" }}
            >
              Install VOYO
            </p>
            <p className="text-[11px] text-white/45 leading-tight mt-0.5 truncate">
              One tap — home-screen launch.
            </p>
          </div>

          <button
            onClick={handleInstall}
            className="flex-shrink-0 px-3.5 py-1.5 rounded-full text-[12px] font-semibold voyo-tap-scale"
            style={{
              background: '#a78bfa',
              color: '#0a0612',
              letterSpacing: '0.01em',
            }}
          >
            Install
          </button>

          <button
            onClick={() => dismiss(true)}
            aria-label="Dismiss"
            className="flex-shrink-0 w-6 h-6 -mr-1 flex items-center justify-center text-white/30 hover:text-white/70 text-lg leading-none voyo-tap-scale"
          >
            ×
          </button>
        </div>

        <style>{`
          @keyframes voyo-install-enter {
            from { opacity: 0; transform: translateY(8px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>

      <IOSInstallSheet open={iosSheetOpen} onClose={() => setIosSheetOpen(false)} platform={platform} />
    </>
  );
}
