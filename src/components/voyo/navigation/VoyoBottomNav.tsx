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
import { Volume1, Volume2 } from 'lucide-react';
import { usePlayerStore } from '../../../store/playerStore';
import { useAuth } from '../../../hooks/useAuth';
import { messagesAPI } from '../../../lib/voyo-api';
import { useOyoInvocation } from '../../../oyo-ui/useOyoInvocation';
import type { InvocationSurface } from '../../../store/oyoStore';

interface VoyoBottomNavProps {
  onDahub?: () => void;
  onHome?: () => void;
  /** Surface to invoke OYO under when the VOYO orb gets long-pressed. */
  oyoSurface?: InvocationSurface;
  /**
   * Player mode — when true, the bottom nav drops the central VOYO orb
   * (the carousel cube IS the player's VOYO control) and renders Home /
   * Dahub as floating corner buttons on the bottom edge of the screen.
   * Background is barely-there (7% on the chips themselves), and the nav
   * stays hidden by default — only revealed at the bottom of a scrollable
   * container, or briefly on touch wake.
   */
  playerMode?: boolean;
}

export const VoyoBottomNav = ({ onDahub, onHome, oyoSurface = 'home', playerMode = false }: VoyoBottomNavProps) => {
  // Fine-grained selectors (battery fix)
  const voyoActiveTab = usePlayerStore(s => s.voyoActiveTab);
  const setVoyoTab = usePlayerStore(s => s.setVoyoTab);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const { dashId, isLoggedIn } = useAuth();

  // VOLUME SLIDER GESTURE: hold a corner of the navbar pill and slide
  // horizontally to scrub volume. Starts from the CURRENT volume so there's
  // no harsh jump (the slide adds to current). Faded sound icons appear in
  // the left/right corners while sliding. Tap fall-through to existing
  // button click is preserved via the slidingRef guard.
  const volume = usePlayerStore(s => s.volume);
  const setVolume = usePlayerStore(s => s.setVolume);
  const [isSliding, setIsSliding] = useState(false);
  const slideStartXRef = useRef(0);
  const slideStartVolRef = useRef(0);
  const slidingRef = useRef(false);
  const SLIDE_THRESHOLD = 8; // px before slide mode activates (preserves taps)
  const SLIDER_TRACK_PX = 280; // map nav width to 100% volume range

  const [promptState, setPromptState] = useState<'clean' | 'love' | 'keep'>('clean');
  const [promptCount, setPromptCount] = useState(0);
  const [unreadDMs, setUnreadDMs] = useState(0);

  // -- Visibility model.
  //    STANDARD mode (home/feed/dahub): always visible, classic pill look.
  //    PLAYER mode: hidden by default, only revealed when the user has
  //                 scrolled past 75% of any scrollable container. When
  //                 revealed, the pill background dims (more translucent)
  //                 but the buttons themselves stay clear. No touch wake.
  const [navState, setNavState] = useState<'full' | 'fade'>('full');
  // promptState changes mid-effect — track via ref so the wake/fade
  // closures don't have to re-bind every time it shifts.
  const promptActiveRef = useRef(false);

  useEffect(() => {
    promptActiveRef.current = promptState !== 'clean';
    // If a prompt animation just started, force full visibility.
    if (promptState !== 'clean') {
      setNavState('full');
    }
  }, [promptState]);

  // PLAYER MODE — listen for scroll on any descendant container, reveal
  // the nav once scroll progress passes 75%. Document-level capture means
  // we catch the scrollable areas inside the player without having to
  // know which one the user is on.
  useEffect(() => {
    if (!playerMode) {
      setNavState('full'); // standard mode is always visible
      return;
    }

    setNavState('fade'); // start hidden in player mode

    const onScroll = (e: Event) => {
      if (promptActiveRef.current) return;
      const target = e.target as HTMLElement | Document | null;
      const el = target instanceof Document ? document.documentElement : (target as HTMLElement | null);
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return; // not scrollable
      const pct = el.scrollTop / max;
      // Hysteresis — reveal at 88% (truly near the bottom), hide back
      // at 84% so the nav doesn't strobe right at the threshold.
      setNavState((prev) => {
        if (pct >= 0.88) return 'full';
        if (pct < 0.84) return 'fade';
        return prev;
      });
    };

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
    };
  }, [playerMode]);

  // Public wake — kept as a no-op shim so existing button handlers don't
  // need to be edited. In standard mode there's nothing to wake; in player
  // mode the scroll-percentage logic owns visibility.
  const wakeNav = useCallback(() => {
    /* visibility is owned by scroll/promptState in this model */
  }, []);

  // -- Tap feedback --
  const [pressedBtn, setPressedBtn] = useState<string | null>(null);
  const handlePointerDown = (id: string) => setPressedBtn(id);
  const handlePointerUp = () => setPressedBtn(null);

  // -- OYO long-press summon (Phase 2) --
  // Auto-pick the surface from current playback context if caller didn't override.
  const inferredSurface: InvocationSurface =
    oyoSurface !== 'home' ? oyoSurface : isPlaying ? 'player' : 'home';
  const { bindLongPress } = useOyoInvocation();
  const oyoBindings = bindLongPress(inferredSurface);

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
    // Suppress click if we just finished a slide gesture
    if (slidingRef.current) { slidingRef.current = false; return; }
    wakeNav();
    onHome?.();
  };

  const handleDahub = () => {
    if (slidingRef.current) { slidingRef.current = false; return; }
    wakeNav();
    onDahub?.();
  };

  // ── VOLUME SLIDER GESTURE HANDLERS ───────────────────────────────
  // Pointer events on the pill capture horizontal slides. If the user
  // moves more than SLIDE_THRESHOLD pixels horizontally, we enter slide
  // mode and own the gesture until pointerup. The button's onClick checks
  // slidingRef and bails if a slide just happened.
  const onPillPointerDown = useCallback((e: React.PointerEvent) => {
    slideStartXRef.current = e.clientX;
    slideStartVolRef.current = usePlayerStore.getState().volume;
  }, []);

  const onPillPointerMove = useCallback((e: React.PointerEvent) => {
    const dx = e.clientX - slideStartXRef.current;
    if (!isSliding && Math.abs(dx) < SLIDE_THRESHOLD) return;
    if (!isSliding) {
      setIsSliding(true);
      slidingRef.current = true;
      // Capture the pointer so subsequent events route here even if outside
      try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch {}
    }
    // Map slide distance to volume delta. Full nav width (~280px) = 100%.
    const deltaPct = (dx / SLIDER_TRACK_PX) * 100;
    const next = Math.max(0, Math.min(100, slideStartVolRef.current + deltaPct));
    setVolume(Math.round(next));
  }, [isSliding, setVolume]);

  const onPillPointerUp = useCallback((e: React.PointerEvent) => {
    if (isSliding) {
      setIsSliding(false);
      try { (e.target as Element).releasePointerCapture?.(e.pointerId); } catch {}
      // Clear slidingRef on next tick so the about-to-fire onClick sees it
      setTimeout(() => { slidingRef.current = false; }, 50);
    }
  }, [isSliding]);

  // 2-state ambient nav: full (100%) or fade (~6% — barely visible hint).
  // The fade-in is fast (responsive to touch), the fade-out is slow (graceful).
  const opacityValue = navState === 'fade' ? 0.06 : 1;
  const opacityTransition =
    navState === 'fade'
      ? 'opacity 1.2s cubic-bezier(0.16, 1, 0.3, 1)'
      : 'opacity 0.35s ease-out';

  return (
    <div
      className="fixed bottom-0 left-0 w-full z-50 px-3 pt-2 pointer-events-none"
      style={{
        // Lift the nav higher off the bottom edge in player mode so
        // it floats above the safe-area instead of hugging it.
        paddingBottom: playerMode
          ? 'max(28px, calc(env(safe-area-inset-bottom) + 20px))'
          : 'max(12px, env(safe-area-inset-bottom))',
        transform: 'translateZ(0)',
        opacity: opacityValue,
        transition: opacityTransition,
      }}
    >
      <div
        className="pointer-events-auto max-w-[280px] mx-auto h-[54px] rounded-full flex items-center justify-around px-3 relative"
        onPointerDown={onPillPointerDown}
        onPointerMove={onPillPointerMove}
        onPointerUp={onPillPointerUp}
        onPointerCancel={onPillPointerUp}
        style={
          playerMode
            ? {
                background: 'transparent',
                border: 'none',
                boxShadow: 'none',
                touchAction: 'pan-y', // allow vertical scrolling, capture horizontal
              }
            : {
                background: 'rgba(10, 10, 15, 0.65)',
                backdropFilter: 'blur(16px) saturate(150%)',
                WebkitBackdropFilter: 'blur(16px) saturate(150%)',
                border: '1px solid rgba(139, 92, 246, 0.08)',
                boxShadow: '0 4px 24px rgba(0,0,0,0.5), 0 0 20px rgba(139,92,246,0.04)',
                touchAction: 'pan-y',
              }
        }
      >
        {/* VOLUME SLIDER VISUALS — faded sound icons in left/right corners
            + horizontal track showing current volume level. Only visible
            during slide gesture. */}
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0, borderRadius: 9999, pointerEvents: 'none',
            opacity: isSliding ? 1 : 0,
            transition: 'opacity 0.2s ease-out',
          }}
        >
          {/* Left sound icon (low volume) */}
          <div style={{
            position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
            color: 'rgba(255,255,255,0.55)',
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
          }}>
            <Volume1 size={16} />
          </div>
          {/* Right sound icon (high volume) */}
          <div style={{
            position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
            color: 'rgba(167,139,250,0.85)',
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
          }}>
            <Volume2 size={18} />
          </div>
          {/* Volume track — purple fill from left edge proportional to volume */}
          <div style={{
            position: 'absolute', left: 36, right: 36, top: '50%',
            height: 2, transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.08)',
            borderRadius: 1,
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${volume}%`,
              background: 'linear-gradient(to right, rgba(167,139,250,0.5), rgba(167,139,250,0.9))',
              boxShadow: '0 0 6px rgba(167,139,250,0.6)',
              transition: 'width 0.05s linear',
            }} />
          </div>
        </div>
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

        {/* CENTER: VOYO ORB
            Long-press (600ms) summons OYO via the bindLongPress() handlers.
            Short tap continues to fire handleVoyoToggle (existing behaviour).
            The onClickCapture inside oyoBindings will swallow the click if
            the long-press threshold was crossed. */}
        <button
          className="relative flex items-center justify-center"
          onPointerDown={(e) => {
            handlePointerDown('voyo');
            oyoBindings.onPointerDown(e);
          }}
          onPointerUp={(e) => {
            handlePointerUp();
            oyoBindings.onPointerUp(e);
          }}
          onPointerLeave={(e) => {
            handlePointerUp();
            oyoBindings.onPointerLeave(e);
          }}
          onPointerCancel={(e) => {
            handlePointerUp();
            oyoBindings.onPointerCancel(e);
          }}
          onClickCapture={oyoBindings.onClickCapture}
          onClick={handleVoyoToggle}
          style={{ flex: '0 0 auto' }}
          aria-label="VOYO — tap to play, long-press to summon OYO"
        >
          <div
            className="relative w-12 h-12 flex flex-col items-center justify-center overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 50%, #6d28d9 100%)',
              // Square morph: while pressed, the round orb "squares up"
              // — OYO is forming. The full long-press fire still launches
              // the actual OYO summon overlay; this is the entrance gesture.
              borderRadius: pressedBtn === 'voyo' ? '14px' : '999px',
              transform: pressedBtn === 'voyo' ? 'scale(1.08)' : 'scale(1)',
              transition: 'border-radius 0.45s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              // Slow ambient halo throb so the orb feels alive even at rest.
              animation: 'voyo-orb-pulse 4.5s ease-in-out infinite',
            }}
          >
            {/* Periodic spark sweep — "I'm still here" sign of life that
                blinks across the orb at long, quiet intervals. */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.55) 50%, transparent 65%)',
                animation: 'voyo-orb-blink 7.3s ease-in-out infinite',
                mixBlendMode: 'screen',
              }}
            />
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
              className="absolute inset-0 flex flex-col items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                borderRadius: pressedBtn === 'voyo' ? '14px' : '999px',
                opacity: promptState === 'keep' ? 1 : 0,
                transition: 'opacity 0.3s ease, border-radius 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
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
