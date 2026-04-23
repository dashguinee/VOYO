import { useEffect, useState } from 'react';

/**
 * useMessagingViewport — tracks the `visualViewport` height so a full-screen
 * chat can shrink when the soft keyboard appears on iOS / Android. Without
 * this, `100vh` / `inset-0` layouts stay frozen at the full screen height and
 * the input bar gets shoved behind the keyboard.
 *
 * Returns:
 *  - `vh` — the effective viewport height (px). Apply via `style={{ height: vh }}`.
 *  - `keyboardOpen` — true if the keyboard is likely up (viewport shortened
 *    by >150px vs innerHeight). Use it to trigger scroll-to-bottom, hide
 *    peripheral chrome, etc.
 *
 * Older browsers without `visualViewport` fall back to a static `innerHeight`
 * — acceptable: those devices don't have the resize-on-keyboard problem to
 * the same degree (mobile Safari and Chrome both ship it).
 */
export function useMessagingViewport() {
  const [vh, setVh] = useState<number>(
    typeof window !== 'undefined' ? window.innerHeight : 0
  );
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const h = vv.height;
      setVh(h);
      // Threshold: >150px shorter than innerHeight ≈ keyboard up
      setKeyboardOpen(window.innerHeight - h > 150);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return { vh, keyboardOpen };
}

export default useMessagingViewport;
