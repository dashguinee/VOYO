/**
 * VOYO Bottom Navigation — Tivi+ Signature Nav Pattern
 * HOME | VOYO (Toggle: Player / Feed) | DAHUB
 *
 * Adapted from DashTivi+ navbar:
 * - 3-tier fade: scrolling 30%, idle 2s 100%, idle 5s+ 12% ghost
 * - Glass surface with subtle border, backdrop-blur-16
 * - ONE accent color (purple #8b5cf6), white at varying opacities
 * - Tap feedback: scale(0.95) 80ms
 * - VOYO center orb: single gradient (purple to violet), brand identity
 * - Prompt overlays fade with CSS transitions, not complex animation libs
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { House, ChatCircle } from '@phosphor-icons/react';
import { usePlayerStore } from '../../../store/playerStore';
import { useAuth } from '../../../hooks/useAuth';
import { messagesAPI } from '../../../lib/voyo-api';

interface VoyoBottomNavProps {
  onDahub?: () => void;
  onHome?: () => void;
}

export const VoyoBottomNav = ({ onDahub, onHome }: VoyoBottomNavProps) => {
  // Fine-grained selectors (battery fix)
  const voyoActiveTab = usePlayerStore(s => s.voyoActiveTab);
  const setVoyoTab = usePlayerStore(s => s.setVoyoTab);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const { dashId, isLoggedIn } = useAuth();

  const [promptState, setPromptState] = useState<'clean' | 'love' | 'keep'>('clean');
  const [promptCount, setPromptCount] = useState(0);
  const [unreadDMs, setUnreadDMs] = useState(0);

  // -- 3-tier fade (from Tivi+) --
  const fadeRef = useRef<'full' | 'dim' | 'ghost'>('full');
  const [navOpacity, setNavOpacity] = useState<'full' | 'dim' | 'ghost'>('full');
  const dimTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ghostTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const onScroll = () => {
      clearTimeout(dimTimer.current);
      clearTimeout(ghostTimer.current);

      if (window.scrollY < 80) {
        if (fadeRef.current !== 'full') {
          fadeRef.current = 'full';
          setNavOpacity('full');
        }
        return;
      }

      // Scrolling -> dim (30%)
      if (fadeRef.current !== 'dim') {
        fadeRef.current = 'dim';
        setNavOpacity('dim');
      }

      // Idle 2s -> full
      dimTimer.current = setTimeout(() => {
        fadeRef.current = 'full';
        setNavOpacity('full');

        // Idle 5s more -> ghost (12%)
        ghostTimer.current = setTimeout(() => {
          if (window.scrollY > 80) {
            fadeRef.current = 'ghost';
            setNavOpacity('ghost');
          }
        }, 5000);
      }, 2000);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(dimTimer.current);
      clearTimeout(ghostTimer.current);
    };
  }, []);

  // Wake from ghost on any tap
  const wakeNav = useCallback(() => {
    clearTimeout(ghostTimer.current);
    if (fadeRef.current !== 'full') {
      fadeRef.current = 'full';
      setNavOpacity('full');
    }
    // Re-arm ghost
    ghostTimer.current = setTimeout(() => {
      if (window.scrollY > 80) {
        fadeRef.current = 'ghost';
        setNavOpacity('ghost');
      }
    }, 7000);
  }, []);

  // -- Tap feedback --
  const [pressedBtn, setPressedBtn] = useState<string | null>(null);
  const handlePointerDown = (id: string) => setPressedBtn(id);
  const handlePointerUp = () => setPressedBtn(null);

  // -- Unread DM count --
  useEffect(() => {
    if (!dashId || !isLoggedIn) {
      setUnreadDMs(0);
      return;
    }

    const fetchUnread = async () => {
      const count = await messagesAPI.getUnreadCount(dashId);
      setUnreadDMs(count);
    };

    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);

    const subscription = messagesAPI.subscribe(dashId, () => {
      setUnreadDMs(prev => prev + 1);
    });

    return () => {
      clearInterval(interval);
      if (subscription) {
        messagesAPI.unsubscribe(subscription);
      }
    };
  }, [dashId, isLoggedIn]);

  // -- VOYO toggle logic --
  const isOnFeed = voyoActiveTab === 'feed';

  // -- Prompt sequence (max 3 per session) --
  useEffect(() => {
    if (!isPlaying || !isOnFeed) {
      setPromptState('clean');
      return;
    }

    if (promptCount >= 3) return;

    const showPromptTimer = setTimeout(() => {
      setPromptState('love');

      setTimeout(() => {
        setPromptState('keep');

        setTimeout(() => {
          setPromptState('clean');
          setPromptCount(prev => prev + 1);
        }, 2500);
      }, 2000);
    }, 8000);

    return () => clearTimeout(showPromptTimer);
  }, [isPlaying, isOnFeed, promptCount]);

  // VOYO center button always lands on the player. The feed entry point lives
  // inside VoyoPortraitPlayer (the dedicated "onVoyoFeed" button), not here.
  // Dash's call: tapping VOYO from anywhere — music, feed, dahub — should
  // bring the player up. No more flip-flop.
  const handleVoyoToggle = () => {
    wakeNav();
    setVoyoTab('music');
  };

  const handleHome = () => {
    wakeNav();
    onHome?.();
  };

  const handleDahub = () => {
    wakeNav();
    onDahub?.();
  };

  // Opacity values matching Tivi+ (dim=30%, ghost=12%, full=100%)
  const opacityValue = navOpacity === 'dim' ? 0.3 : navOpacity === 'ghost' ? 0.12 : 1;
  const opacityTransition =
    navOpacity === 'dim'
      ? 'opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1)'
      : navOpacity === 'ghost'
        ? 'opacity 2s cubic-bezier(0.16, 1, 0.3, 1)'
        : 'opacity 0.4s ease-out';

  return (
    <div
      className="fixed bottom-0 left-0 w-full z-50 px-3 pt-2 pointer-events-none"
      style={{
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        transform: 'translateZ(0)',
        opacity: opacityValue,
        transition: opacityTransition,
      }}
    >
      <div
        className="pointer-events-auto max-w-[280px] mx-auto h-[54px] rounded-full flex items-center justify-around px-3"
        style={{
          background: 'rgba(10, 10, 15, 0.65)',
          backdropFilter: 'blur(16px) saturate(150%)',
          WebkitBackdropFilter: 'blur(16px) saturate(150%)',
          border: '1px solid rgba(139, 92, 246, 0.08)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.5), 0 0 20px rgba(139,92,246,0.04)',
        }}
      >
        {/* LEFT: HOME */}
        <button
          className="relative flex items-center justify-center flex-1 h-full"
          onPointerDown={() => handlePointerDown('home')}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onClick={handleHome}
        >
          <div
            style={{
              transform: pressedBtn === 'home' ? 'scale(0.95)' : 'scale(1)',
              transition: 'transform 80ms ease-out',
            }}
          >
            <House
              size={20}
              weight="duotone"
              color="rgba(255, 255, 255, 0.4)"
              style={{ transition: 'color 0.15s ease' }}
            />
          </div>
        </button>

        {/* CENTER: VOYO ORB */}
        <button
          className="relative flex items-center justify-center"
          onPointerDown={() => handlePointerDown('voyo')}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onClick={handleVoyoToggle}
          style={{ flex: '0 0 auto' }}
        >
          <div
            className="relative w-12 h-12 rounded-full flex flex-col items-center justify-center overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 50%, #6d28d9 100%)',
              boxShadow: '0 0 20px rgba(139, 92, 246, 0.35), 0 4px 16px rgba(0,0,0,0.4)',
              transform: pressedBtn === 'voyo' ? 'scale(0.95)' : 'scale(1)',
              transition: 'transform 80ms ease-out, box-shadow 0.3s ease',
            }}
          >
            {/* Base: VOYO text */}
            <div
              className="flex flex-col items-center"
              style={{
                opacity: promptState === 'keep' ? 0 : 1,
                transition: 'opacity 0.3s ease',
              }}
            >
              <span
                className="font-black text-sm text-white tracking-tight"
                style={{ lineHeight: 1.2 }}
              >
                VOYO
              </span>
            </div>

            {/* Prompt: "Love this Vibe?" floats above */}
            <div
              className="absolute -top-6 left-1/2 whitespace-nowrap"
              style={{
                transform: 'translateX(-50%)',
                opacity: promptState === 'love' ? 1 : 0,
                transition: 'opacity 0.4s ease',
                pointerEvents: 'none',
              }}
            >
              <span className="text-[9px] text-white/80 font-medium">Love this Vibe?</span>
            </div>

            {/* Prompt: "Keep Playing" fills the orb */}
            <div
              className="absolute inset-0 flex flex-col items-center justify-center rounded-full"
              style={{
                background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                opacity: promptState === 'keep' ? 1 : 0,
                transition: 'opacity 0.3s ease',
                pointerEvents: promptState === 'keep' ? 'auto' : 'none',
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="white"
                style={{ marginBottom: 2 }}
              >
                <polygon points="5,3 19,12 5,21" />
              </svg>
              <span className="text-[7px] text-white/80 uppercase tracking-wider">
                Keep Playing
              </span>
            </div>
          </div>
        </button>

        {/* RIGHT: DAHUB */}
        <button
          className="relative flex items-center justify-center flex-1 h-full"
          onPointerDown={() => handlePointerDown('dahub')}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onClick={handleDahub}
        >
          <div
            style={{
              transform: pressedBtn === 'dahub' ? 'scale(0.95)' : 'scale(1)',
              transition: 'transform 80ms ease-out',
            }}
          >
            <div className="relative">
              <ChatCircle
                size={20}
                weight="duotone"
                color="rgba(255, 255, 255, 0.4)"
                style={{ transition: 'color 0.15s ease' }}
              />
              {/* Unread DM badge: simple red dot */}
              {unreadDMs > 0 && (
                <div
                  className="absolute -top-1 -right-1.5 w-[8px] h-[8px] rounded-full"
                  style={{
                    background: '#ef4444',
                    boxShadow: '0 0 6px rgba(239, 68, 68, 0.6)',
                  }}
                />
              )}
            </div>
          </div>
        </button>
      </div>
    </div>
  );
};

export default VoyoBottomNav;
