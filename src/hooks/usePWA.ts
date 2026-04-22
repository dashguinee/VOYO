import { useState, useEffect, useCallback } from 'react';
import { trace } from '../services/telemetry';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface NavigatorWithRelated extends Navigator {
  getInstalledRelatedApps?: () => Promise<Array<{ platform: string; url?: string; id?: string }>>;
}

export type Platform = 'ios' | 'android' | 'desktop' | 'unknown';

// Persisted install marker. Set whenever we're sure the PWA is on-device
// (appinstalled event, standalone display-mode, or related-apps lookup).
// Read first thing on mount so the install UI never flashes on a PWA
// that's already been installed.
const INSTALLED_KEY = 'voyo-pwa-installed-at';

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
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

function writeInstalledFlag() {
  try { localStorage.setItem(INSTALLED_KEY, String(Date.now())); } catch { /* private mode */ }
}

export function usePWA() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(() => isStandaloneDisplay() || readInstalledFlag());
  const [platform, setPlatform] = useState<Platform>('unknown');

  useEffect(() => {
    const p = detectPlatform();
    setPlatform(p);

    // Standalone display → definitely running as installed PWA. Stamp
    // the flag so future tab visits know too.
    if (isStandaloneDisplay()) {
      setIsInstalled(true);
      writeInstalledFlag();
      return;
    }

    // Persisted flag from a prior appinstalled event — don't show install
    // UI again on any future tab visit.
    if (readInstalledFlag()) {
      setIsInstalled(true);
      return;
    }

    // Android Chrome can tell us whether a related web app is installed,
    // provided the manifest lists a self-reference in related_applications.
    // Desktop Chrome also supports this. Runs async so the first render
    // may still flash install UI briefly on installed devices — that's
    // why writeInstalledFlag() above latches the state permanently.
    const nav = navigator as NavigatorWithRelated;
    if (typeof nav.getInstalledRelatedApps === 'function') {
      nav.getInstalledRelatedApps().then((related) => {
        if (related.some((app) => app.platform === 'webapp')) {
          setIsInstalled(true);
          setIsInstallable(false);
          writeInstalledFlag();
        }
      }).catch(() => { /* API rejected — fall through to normal flow */ });
    }

    // Always installable otherwise — the click handler routes to native
    // prompt if Chrome fires one, else to manual instructions. iOS has no
    // programmatic path so this is the only way iOS users see the UI.
    setIsInstallable(true);

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
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

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
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
