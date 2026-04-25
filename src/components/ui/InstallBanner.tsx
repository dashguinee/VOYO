import { useEffect, useRef, useState } from 'react';
import { usePWA } from '../../hooks/usePWA';
import { IOSInstallSheet } from './IOSInstallSheet';
import { trace } from '../../services/telemetry';
import {
  bannerBecameVisible,
  bannerResolved,
  bannerSkipped,
  hasShownBeenLogged,
  markShownLogged,
} from '../../hooks/installSurface';

const DISMISS_KEY = 'voyo-install-banner-dismissed-at';
const COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

const SESSION_KEY = 'voyo-install-banner-seen';

// The GreetingBanner plays for 5.2s. Land at 8s so the two moments never
// overlap — greeting exits, a beat of quiet, install appears.
const SHOW_DELAY_MS = 8000;

// Auto-dismiss so the banner never overstays its welcome. 10s is enough
// to read + decide; after that it fades out on its own.
const AUTO_HIDE_MS = 10000;

// Swipe-up threshold — past this distance the card is released and
// dismissed; below it, we snap back.
const SWIPE_DISMISS_PX = 48;

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
 * Install moment — top-of-screen glass card, aligned with the profile /
 * search row so it feels like a header announcement rather than a toast.
 *
 *   - Fires 8s after mount (greeting done) once per session.
 *   - Auto-hides after 10s visible.
 *   - Swipe-up to dismiss with localStorage 14-day cooldown.
 *   - Tapping × also persists dismissal.
 *   - Premium = restraint: one VOYO mark, one gradient, static motion.
 */
export function InstallBanner() {
  const { isInstallable, isInstalled, install, platform, hasNativePrompt } = usePWA();
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [iosSheetOpen, setIosSheetOpen] = useState(false);

  // Live drag offset while swiping up. Positive = no drag, negative = dragged up.
  const [dragY, setDragY] = useState(0);
  const dragStartY = useRef<number | null>(null);
  const dragActive = useRef(false);

  useEffect(() => {
    if (isInstalled) {
      setVisible(false);
      // Terminal state — pill also won't render, but make the coordination
      // state deterministic.
      bannerResolved();
      return;
    }
    // Wait for usePWA to settle isInstallable. While it's false (still
    // resolving, or unsupported platform), leave the phase as 'pending'
    // so the pill doesn't render prematurely. If we land on unsupported
    // the pill's own `!isInstallable` guard keeps it hidden regardless.
    if (!isInstallable) return;

    if (wasSeenThisSession() || isDismissedRecently()) {
      // Banner is suppressed this session — let the pill come up now.
      bannerSkipped();
      return;
    }

    const showTimer = window.setTimeout(() => {
      setVisible(true);
      markSeenThisSession();
      bannerBecameVisible();
      // Consolidated shown telemetry — whichever surface renders first
      // claims it. Pill skips shown if banner already logged.
      if (!hasShownBeenLogged()) {
        markShownLogged();
        trace('pwa_install_shown', null, { surface: 'banner', platform, has_native_prompt: hasNativePrompt });
      }
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(showTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInstallable, isInstalled]);

  // Auto-hide after 10s of visibility. Cancelled if user is actively
  // dragging (don't yank the card out from under their finger).
  useEffect(() => {
    if (!visible || leaving) return;
    const t = window.setTimeout(() => {
      if (!dragActive.current) dismiss(false, 'auto');
    }, AUTO_HIDE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, leaving]);

  const dismiss = (remember: boolean, dismissType: 'x' | 'swipe' | 'auto' | 'installed' = 'auto') => {
    setLeaving(true);
    window.setTimeout(() => setVisible(false), 360);
    if (remember) {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
    }
    if (dismissType !== 'installed') {
      trace('pwa_install_dismissed', null, { surface: 'banner', platform, dismiss_type: dismissType });
    }
    // Banner is on its way out — release the pill to render.
    bannerResolved();
  };

  const handleInstall = async () => {
    trace('pwa_install_clicked', null, { surface: 'banner', platform, has_native_prompt: hasNativePrompt });
    if (platform === 'ios' || !hasNativePrompt) {
      // Opening the manual-instructions sheet counts as "user engaged
      // with install" — mark the 14-day cooldown so the top banner
      // doesn't re-nag this session. Banner fades out; the sheet
      // stays until the user closes it via its own × or back gesture.
      setIosSheetOpen(true);
      trace('pwa_install_sheet_opened', null, { surface: 'banner', platform });
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
      dismiss(false, 'installed');
      return;
    }
    const ok = await install();
    if (ok) {
      trace('pwa_install_accepted', null, { surface: 'banner', platform });
      dismiss(false, 'installed');
    } else {
      trace('pwa_install_dismissed', null, { surface: 'banner', platform, dismiss_type: 'native_cancelled' });
    }
  };

  // ── Swipe-up gesture ────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    dragStartY.current = e.clientY;
    dragActive.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragStartY.current === null) return;
    const delta = e.clientY - dragStartY.current;
    // Only track upward motion — downward drag does nothing.
    setDragY(Math.min(0, delta));
  };
  const onPointerUp = () => {
    dragActive.current = false;
    if (dragStartY.current === null) return;
    const dragged = dragY;
    dragStartY.current = null;
    if (dragged <= -SWIPE_DISMISS_PX) {
      // Commit the dismissal — remember for 14 days, just like the ×.
      dismiss(true, 'swipe');
    } else {
      // Snap back.
      setDragY(0);
    }
  };

  if (!visible) {
    return <IOSInstallSheet open={iosSheetOpen} onClose={() => setIosSheetOpen(false)} platform={platform} />;
  }

  // Card transform: enter animation handled by CSS keyframe, drag offset
  // layered on top. When leaving we fade out + lift slightly.
  const transform = leaving
    ? 'translateY(-12px)'
    : `translateY(${dragY}px)`;

  const opacity = leaving
    ? 0
    : Math.max(0.25, 1 + dragY / 120); // fade as dragged up

  return (
    <>
      <div
        className="fixed left-0 right-0 z-[55] flex justify-center px-4 pointer-events-none"
        style={{
          // Profile-icon level — just below the header strip. Header is
          // safe-area + py-3 + ~36px icon buttons ≈ 60px. 64px leaves a
          // hairline gap so it doesn't graze the icons.
          top: 'calc(env(safe-area-inset-top) + 64px)',
          touchAction: 'pan-y',
        }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="pointer-events-auto w-full max-w-sm rounded-2xl px-4 py-3.5 flex items-center gap-3 select-none"
          style={{
            background: 'rgba(15, 12, 24, 0.82)',
            backdropFilter: 'blur(24px) saturate(140%)',
            WebkitBackdropFilter: 'blur(24px) saturate(140%)',
            border: '1px solid rgba(255,255,255,0.06)',
            boxShadow: '0 20px 60px -20px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.04) inset',
            opacity,
            transform,
            transition: dragActive.current
              ? 'none'
              : 'opacity 360ms cubic-bezier(0.2, 0.8, 0.2, 1), transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            animation: leaving || dragActive.current ? undefined : 'voyo-install-enter 480ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            cursor: 'grab',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 192 192" className="flex-shrink-0 pointer-events-none">
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

          <div className="flex-1 min-w-0 pointer-events-none">
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
            onPointerDown={(e) => e.stopPropagation()}
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
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => dismiss(true, 'x')}
            aria-label="Dismiss"
            className="flex-shrink-0 w-6 h-6 -mr-1 flex items-center justify-center text-white/30 hover:text-white/70 text-lg leading-none voyo-tap-scale"
          >
            ×
          </button>
        </div>

        <style>{`
          @keyframes voyo-install-enter {
            from { opacity: 0; transform: translateY(-8px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>

      <IOSInstallSheet open={iosSheetOpen} onClose={() => setIosSheetOpen(false)} platform={platform} />
    </>
  );
}
