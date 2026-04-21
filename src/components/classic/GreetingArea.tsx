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
  // Start in "live" mode if we've already seen the greeting this session.
  const [bannerDone, setBannerDone] = useState(() => {
    try { return !!sessionStorage.getItem('voyo-greeting-shown-v1'); }
    catch { return false; }
  });

  if (!bannerDone) {
    return <GreetingBanner onComplete={() => setBannerDone(true)} />;
  }
  return <LiveStatusBar />;
};

export default GreetingArea;
