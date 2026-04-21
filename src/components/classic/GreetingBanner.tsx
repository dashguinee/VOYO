/**
 * GreetingBanner — time-aware welcome that fades + rises into the top
 * of the feed on session start, shimmers in the VOYO bronze palette,
 * then fades out. Shows once per session (sessionStorage-gated) so it
 * feels like an arrival moment, not a permanent chrome element.
 *
 * Tone: ambient, premium, not a toast. If the user scrolls or taps
 * anything, it dismisses itself early — the greeting is never in the
 * way.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';

// Day-keyed localStorage — "first time today on Home" instead of "first
// time this tab session". Surviving across PWA relaunches is the whole
// point: the greeting is a daily arrival moment, not a per-tab toast.
const STORAGE_KEY_PREFIX = 'voyo-greeting-shown-';
const todayKey = () => STORAGE_KEY_PREFIX + new Date().toISOString().slice(0, 10);
const LIFETIME_MS = 5200; // fade-in 600ms → hold 3400ms → fade-out 1200ms

function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good Morning';
  if (hour >= 12 && hour < 17) return 'Good Afternoon';
  if (hour >= 17 && hour < 22) return 'Good Evening';
  return 'Welcome Back';
}

interface GreetingBannerProps {
  /** Fires when the banner has finished fading out. Lets a parent swap
   * in a follow-up component (e.g. a live status bar) in the same slot. */
  onComplete?: () => void;
}

export const GreetingBanner = ({ onComplete }: GreetingBannerProps = {}) => {
  const [phase, setPhase] = useState<'hidden' | 'rising' | 'settled' | 'leaving' | 'done'>('hidden');
  const { displayName } = useAuth();

  const { greeting, name } = useMemo(() => {
    const hour = new Date().getHours();
    return {
      greeting: greetingFor(hour),
      // Split at first space so long names get clean first-name only.
      // Guaranteed non-empty here — the effect below bails out if
      // displayName hasn't arrived yet.
      name: (displayName || '').split(' ')[0],
    };
  }, [displayName]);

  useEffect(() => {
    // Wait for a real name. FirstTimeLoader captures one on brand-new
    // sessions and useAuth propagates it via NAME_CHANGE_EVENT; this
    // effect re-runs when displayName fills in so the greeting lands
    // WITH the user's name, not a generic fallback.
    if (!displayName) {
      setPhase('hidden');
      return;
    }

    const key = todayKey();
    try {
      if (localStorage.getItem(key)) {
        setPhase('done');
        onComplete?.();
        return;
      }
    } catch { /* localStorage unavailable — still show once per mount */ }

    // Small delay so the banner lands AFTER the feed's first paint —
    // reads as a moment that "appears", not a boot artifact.
    const riseTimer = setTimeout(() => setPhase('rising'), 220);
    const settleTimer = setTimeout(() => setPhase('settled'), 220 + 600);
    const leaveTimer = setTimeout(() => setPhase('leaving'), LIFETIME_MS - 1200);
    // Mark "shown today" ONLY when the full animation completes — avoids
    // consuming the flag if the user/tree unmounts before it plays.
    const doneTimer = setTimeout(() => {
      try { localStorage.setItem(key, String(Date.now())); } catch {}
      setPhase('done');
      onComplete?.();
    }, LIFETIME_MS);
    return () => {
      clearTimeout(riseTimer);
      clearTimeout(settleTimer);
      clearTimeout(leaveTimer);
      clearTimeout(doneTimer);
    };
  }, [displayName, onComplete]);

  if (phase === 'done') return null;

  const visible = phase === 'rising' || phase === 'settled';
  const leaving = phase === 'leaving';

  return (
    <div
      className="pointer-events-none px-4 pt-6 pb-4"
      style={{
        opacity: leaving ? 0 : visible ? 1 : 0,
        transform: leaving
          ? 'translateY(-8px)'
          : visible ? 'translateY(0)' : 'translateY(16px)',
        transition: leaving
          ? 'opacity 1200ms ease-in, transform 1200ms ease-in'
          : 'opacity 600ms cubic-bezier(0.2, 0.8, 0.2, 1), transform 600ms cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}
    >
      <div className="relative inline-block">
        <h2
          className="text-[28px] font-bold leading-tight tracking-tight"
          style={{
            fontFamily: "'Satoshi', sans-serif",
            // Bronze → gold → bronze gradient, clipped to text.
            background:
              'linear-gradient(90deg, #8B6228 0%, #C4943D 18%, #E6B865 35%, #FFF3D6 50%, #E6B865 65%, #C4943D 82%, #8B6228 100%)',
            backgroundSize: '240% 100%',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            // Shimmer sweep — the gradient's 240% width slides across the
            // text so the highlight band travels left→right. 3.2s matches
            // the banner's settled hold duration for one full pass.
            animation: visible ? 'voyo-greeting-shimmer 3200ms ease-in-out 1' : undefined,
            filter: 'drop-shadow(0 0 14px rgba(212,160,83,0.22))',
          }}
        >
          {greeting}, {name}
        </h2>
        {/* Thin bronze underline flourish */}
        <div
          className="h-[1.5px] mt-1.5 rounded-full"
          style={{
            width: visible ? '52%' : '0%',
            background:
              'linear-gradient(90deg, rgba(212,160,83,0.85) 0%, rgba(230,184,101,0.6) 50%, rgba(212,160,83,0.08) 100%)',
            transition: 'width 900ms cubic-bezier(0.2, 0.8, 0.2, 1) 200ms',
          }}
        />
      </div>

      <style>{`
        @keyframes voyo-greeting-shimmer {
          0%   { background-position: 100% 50%; }
          100% { background-position: -100% 50%; }
        }
      `}</style>
    </div>
  );
};

export default GreetingBanner;
