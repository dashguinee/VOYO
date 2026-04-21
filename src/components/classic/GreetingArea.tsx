/**
 * GreetingArea — orchestrates the top-of-feed narrative slot.
 *
 * Session start → GreetingBanner (flashy, fade-rise + bronze shimmer).
 * After it finishes → LiveStatusBar (ambient live tale of the app).
 *
 * Single-slot swap: the banner fully leaves before the status bar eases
 * in, so the user experiences one moment (arrival) settling into a
 * quieter steady state (live).
 */

import { useState } from 'react';
import { GreetingBanner } from './GreetingBanner';
import { LiveStatusBar } from './LiveStatusBar';

export const GreetingArea = () => {
  // Skip straight to "live" if we've already played the greeting today.
  // Day-scoped so the banner returns the next calendar day, not on every
  // PWA relaunch.
  const [bannerDone, setBannerDone] = useState(() => {
    try {
      const key = 'voyo-greeting-shown-' + new Date().toISOString().slice(0, 10);
      return !!localStorage.getItem(key);
    } catch { return false; }
  });

  if (!bannerDone) {
    return <GreetingBanner onComplete={() => setBannerDone(true)} />;
  }
  return <LiveStatusBar />;
};

export default GreetingArea;
