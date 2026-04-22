import { useEffect, useRef } from 'react';

/**
 * useTabHistory — tab-level back-gesture support.
 *
 * useBackGuard handles MODALS (things that open and close). Tabs are
 * different: they're always mounted and the user "switches" between
 * them. Pressing system back while on tab B should return them to tab
 * A, not exit the app.
 *
 * Usage:
 *   useTabHistory(voyoActiveTab, setVoyoTab, 'voyo-tab');
 *
 * On every programmatic tab change (tap / setter), pushes a history
 * entry tagged { voyoTabStack: name, to: newValue }. On popstate, if
 * the landed state carries our marker we call setActive(state.to); if
 * we've popped PAST all our entries (state.voyoTabStack missing), we
 * restore the mount-time initial tab so the user lands back on the
 * entry tab rather than getting stranded mid-stack.
 *
 * Composition: nested modals (Search opened from Feed) use
 * useBackGuard, which pushes its own entry above ours. Back peels
 * modals first via popstate, then the next back press lands on our
 * tab entry and restores the previous tab. One back = one layer
 * peeled, at every depth.
 */
export function useTabHistory<T extends string>(
  active: T,
  setActive: (t: T) => void,
  name: string,
): void {
  const lastRef = useRef<T>(active);
  const initialRef = useRef<T>(active);
  const suppressNextRef = useRef(false);

  // Push on every in-app tab change. Skip when the change came FROM a
  // popstate (suppressNextRef) — otherwise we'd push a duplicate entry
  // that blocks back from ever popping past it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (lastRef.current === active) return;

    if (suppressNextRef.current) {
      suppressNextRef.current = false;
      lastRef.current = active;
      return;
    }

    lastRef.current = active;
    try {
      window.history.pushState({ voyoTabStack: name, to: active }, '');
    } catch { /* private mode / security restrictions */ }
  }, [active, name]);

  // Popstate handler — restore the tab represented by the landed state,
  // or fall back to the mount-time initial if we've popped past our
  // stack entirely.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = (e: PopStateEvent) => {
      const s = e.state as { voyoTabStack?: string; to?: string } | null;

      if (s?.voyoTabStack === name && typeof s.to === 'string') {
        // Landed on one of our entries. Restore its tab value.
        suppressNextRef.current = true;
        lastRef.current = s.to as T;
        setActive(s.to as T);
        return;
      }

      // Popped past our stack (back before this hook pushed anything).
      // If we're not already on the initial tab, restore it so the user
      // doesn't get stranded on whichever tab they were viewing when
      // the previous layer was closed.
      if (lastRef.current !== initialRef.current) {
        suppressNextRef.current = true;
        lastRef.current = initialRef.current;
        setActive(initialRef.current);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [setActive, name]);
}
