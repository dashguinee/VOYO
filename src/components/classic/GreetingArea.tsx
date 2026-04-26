/**
 * GreetingArea — orchestrates the top-of-feed narrative slot.
 *
 * Session start → GreetingBanner (flashy, fade-rise + bronze shimmer).
 * After it finishes → null. The ambient tale layer that used to live
 * here (LiveStatusBar) has been folded into the AnchoredTaleHeader
 * inside VoyoLiveCard so the dot is the single anchor for both the
 * "Oyé We Live" identity and the rolling live tales.
 */

import { useState } from 'react';
import { GreetingBanner } from './GreetingBanner';

export const GreetingArea = () => {
  // Skip straight past the banner if we've already played it today.
  // Day-scoped so it returns the next calendar day, not on every PWA relaunch.
  const [bannerDone, setBannerDone] = useState(() => {
    try {
      const key = 'voyo-greeting-shown-' + new Date().toISOString().slice(0, 10);
      return !!localStorage.getItem(key);
    } catch { return false; }
  });

  if (!bannerDone) {
    return <GreetingBanner onComplete={() => setBannerDone(true)} />;
  }
  return null;
};

export default GreetingArea;
