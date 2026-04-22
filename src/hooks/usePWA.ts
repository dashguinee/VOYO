import { useState, useEffect, useCallback } from 'react';
import { trace } from '../services/telemetry';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface NavigatorWithRelated extends Navigator {
  getInstalledRelatedApps?: () => Promise<Array<{ platform: string; url?: string; id?: string }>>;
}

export type Platform = 'ios' | 'android' | 'desktop' | 'unsupported' | 'unknown';

// Persisted install marker. Set whenever we're sure the PWA is on-device
// (appinstalled event, standalone display-mode, or related-apps lookup).
// Read first thing on mount so the install UI never flashes on a PWA
// that's already been installed.
const INSTALLED_KEY = 'voyo-pwa-installed-at';

// UA fragments that mark an environment where PWA install is impossible
// or the manual instructions we ship would lead nowhere.
//   - In-app browsers (Instagram, Facebook, Twitter/X, TikTok, Snapchat,
//     LinkedIn, Pinterest, Line) don't expose Chrome's install menu and
//     don't fire beforeinstallprompt.
//   - Desktop Firefox has no PWA install at all.
//   - Safari on macOS has no A2HS path — only Safari iOS does.
//   - iOS Chrome / iOS Firefox are WebKit shells with no Share → A2HS
//     entry point tied to their UI.
const IN_APP_UA = /Instagram|FBAV|FBAN|FB_IAB|FBIOS|Twitter|TikTok|Snapchat|LinkedInApp|Pinterest|Line\//i;

function isInAppBrowser(ua: string): boolean {
  if (IN_APP_UA.test(ua)) return true;
  // Android WebView marker — ` wv)` appears in the UA on WebView chromes.
  if (/Android/.test(ua) && /; wv\)/.test(ua)) return true;
  return false;
}

function isDesktopFirefox(ua: string): boolean {
  return /Firefox\//.test(ua) && !/Android|Mobile|iPhone|iPad|iPod/i.test(ua);
}

function isMacSafari(ua: string): boolean {
  // Safari-macOS: "Safari/" present, "Macintosh" present, NOT Chrome/Edge/OPR/Firefox.
  return /Safari\//.test(ua)
    && /Macintosh/.test(ua)
    && !/Chrome|Chromium|Edg\/|OPR\/|Firefox\//.test(ua);
}

function isIosChromeOrFirefox(ua: string): boolean {
  return /iPhone|iPad|iPod/.test(ua) && /CriOS|FxiOS|EdgiOS/.test(ua);
}

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;

  // Environments where we cannot install — bail out before iOS/Android
  // UA sniffs so the pill/banner/sheet never render false hope.
  if (isInAppBrowser(ua)) return 'unsupported';
  if (isDesktopFirefox(ua)) return 'unsupported';
  if (isMacSafari(ua)) return 'unsupported';
  if (isIosChromeOrFirefox(ua)) return 'unsupported';

  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
  if (isIOS) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches ||
         (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function readInstalledFlag(): boolean {
  try { return !!localStorage.getItem(INSTALLED_KEY); } catch { return false; }
}

function readInstalledFlagAge(): number | null {
  try {
    const v = localStorage.getItem(INSTALLED_KEY);
    if (!v) return null;
    const t = parseInt(v, 10);
    if (!Number.isFinite(t)) return null;
    return Date.now() - t;
  } catch { return null; }
}

function writeInstalledFlag() {
  try { localStorage.setItem(INSTALLED_KEY, String(Date.now())); } catch { /* private mode */ }
}

function clearInstalledFlag() {
  try { localStorage.removeItem(INSTALLED_KEY); } catch { /* private mode */ }
}

// How long the localStorage latch is trusted without corroborating
// evidence (standalone-display OR getInstalledRelatedApps). Uninstalling
// a PWA doesn't clear origin localStorage on Chrome Android or iOS
// Safari, so a stale latch can lock out genuine re-install intent. 48h
// is short enough that uninstall-reinstall feels snappy, long enough that
// routine visits don't re-probe every page load.
const INSTALLED_FLAG_TTL_MS = 48 * 60 * 60 * 1000;

export function usePWA() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(() => isStandaloneDisplay() || readInstalledFlag());
  const [platform, setPlatform] = useState<Platform>('unknown');

  useEffect(() => {
    const p = detectPlatform();
    setPlatform(p);

    // ── Latch reconciliation ──────────────────────────────────────────
    // `voyo-pwa-installed-at` is a cache, not ground truth. If the user
    // uninstalled, the origin's localStorage survives — so we periodically
    // cross-check the latch against live signals:
    //   - isStandaloneDisplay() — running AS the installed PWA now
    //   - getInstalledRelatedApps() — Chrome reports an installed WebAPK
    //   - beforeinstallprompt firing — authoritative "not installed right
    //     now" signal from the browser
    // Also: the latch expires after TTL_MS if none of the above confirm.
    const reconcileLatch = async () => {
      if (!readInstalledFlag()) return;
      if (isStandaloneDisplay()) {
        // Running as standalone — latch is accurate, refresh its timestamp.
        writeInstalledFlag();
        return;
      }
      const nav = navigator as NavigatorWithRelated;
      if (typeof nav.getInstalledRelatedApps === 'function') {
        try {
          const related = await nav.getInstalledRelatedApps();
          if (related.some((app) => app.platform === 'webapp')) {
            // Confirmed installed — refresh.
            writeInstalledFlag();
            return;
          }
          // API responded empty AND we're not standalone. On Android /
          // desktop Chrome this is reliable — clear the stale latch.
          if (p === 'android' || p === 'desktop') {
            clearInstalledFlag();
            setIsInstalled(false);
            return;
          }
        } catch { /* fall through to TTL path */ }
      }
      // No authoritative signal (iOS, old Chrome, API rejected). Fall
      // back to TTL: if the flag is older than the window, assume the
      // user uninstalled and let the install UI come back.
      const age = readInstalledFlagAge();
      if (age !== null && age > INSTALLED_FLAG_TTL_MS) {
        clearInstalledFlag();
        setIsInstalled(false);
      }
    };

    // Standalone display → definitely running as installed PWA. Stamp
    // the flag so future tab visits know too.
    if (isStandaloneDisplay()) {
      setIsInstalled(true);
      writeInstalledFlag();
      return;
    }

    // Environments where install UI cannot lead anywhere useful:
    // in-app browsers (Instagram/TikTok/FB/…), desktop Firefox, Safari
    // macOS, iOS Chrome/Firefox. The manual-instructions sheet we ship
    // would tell them to open a menu that doesn't exist for them.
    if (p === 'unsupported' || p === 'unknown') {
      setIsInstallable(false);
      return;
    }

    // Kick off reconciliation. If the latch was set but the user has
    // actually uninstalled, this will flip isInstalled back to false and
    // unlock the install flow.
    void reconcileLatch();

    // Persisted flag still holds (not reconciled away yet) — honour it,
    // but keep listeners attached so a later beforeinstallprompt can
    // reconcile via the cheap path.
    const latchStillHeld = readInstalledFlag();
    if (latchStillHeld) {
      setIsInstalled(true);
    }

    // Android Chrome can tell us whether a related web app is installed,
    // provided the manifest lists a self-reference in related_applications.
    // Desktop Chrome also supports this. Runs async so the first render
    // may still flash install UI briefly on installed devices — that's
    // why writeInstalledFlag() above latches the state permanently.
    const nav = navigator as NavigatorWithRelated;
    if (!latchStillHeld && typeof nav.getInstalledRelatedApps === 'function') {
      nav.getInstalledRelatedApps().then((related) => {
        if (related.some((app) => app.platform === 'webapp')) {
          setIsInstalled(true);
          setIsInstallable(false);
          writeInstalledFlag();
        }
      }).catch(() => { /* API rejected — fall through to normal flow */ });
    }

    // Supported platforms only (android / ios / desktop-Chromium). The
    // click handler routes to native prompt if Chrome fires one, else to
    // manual instructions. iOS Safari has no programmatic path so this
    // is the only way iOS users see the UI.
    if (!latchStillHeld) setIsInstallable(true);

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      // The browser firing beforeinstallprompt is an authoritative
      // "you can install right now" signal — which means we're NOT
      // currently installed. Clear any stale latch and re-open the UI.
      if (readInstalledFlag()) {
        clearInstalledFlag();
        setIsInstalled(false);
      }
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
      writeInstalledFlag();
      trace('pwa_install_completed', null, { platform: p });
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void reconcileLatch();
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return false;

    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === 'accepted') {
        setIsInstalled(true);
        setIsInstallable(false);
        writeInstalledFlag();
      }

      setDeferredPrompt(null);
      return outcome === 'accepted';
    } catch {
      return false;
    }
  }, [deferredPrompt]);

  return {
    isInstallable,
    isInstalled,
    install,
    platform,
    hasNativePrompt: deferredPrompt !== null,
  };
}
