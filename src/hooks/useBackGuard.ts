import { useEffect, useRef } from 'react';

/**
 * useBackGuard — makes any modal / overlay respect the system back gesture
 * (browser Back button, Android system back, iOS swipe-from-edge).
 *
 * On open, pushes a history entry tagged `{ voyoModal: name }`. The browser's
 * back gesture then POPs that entry and fires `popstate`, which we listen to
 * and use to fire `onClose`. Net result: back closes the layer instead of
 * exiting the app.
 *
 * On UI close (user taps ×), the hook notices and silently calls
 * `history.back()` so the pushed entry gets popped too — no orphan history
 * entries pile up as the user opens/closes things.
 *
 * Name the layers so nested overlays (e.g. DiscoExplainer opened from inside
 * SearchOverlay) each get their own history entry, popping in the right order.
 *
 * Reference pattern used across: SearchOverlay, Library, UniversePanel,
 * PlaylistModal, DiscoExplainer, IOSInstallSheet, VideoMode.
 */
export function useBackGuard(open: boolean, onClose: () => void, name: string): void {
  // Stable ref so the effect doesn't re-run just because the parent rendered
  // with a new onClose closure.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    if (typeof window === 'undefined') return;

    const marker = { voyoModal: name, ts: Date.now() };
    window.history.pushState(marker, '');

    let closingFromPop = false;
    const onPop = () => {
      closingFromPop = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      // Closed via UI (not the back gesture) → roll back our pushState
      // so the history doesn't accumulate entries for every modal
      // open/close. Detect by checking the marker is still on top of
      // history — if popstate already fired, the browser has moved past it.
      if (!closingFromPop) {
        const top = window.history.state as { voyoModal?: string } | null;
        if (top?.voyoModal === name) {
          window.history.back();
        }
      }
    };
  }, [open, name]);
}
