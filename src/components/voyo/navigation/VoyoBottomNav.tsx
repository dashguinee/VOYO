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
import { Home as House, MessageCircle as ChatCircle } from 'lucide-react';
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
  // Ambient nav fade — when on feed and the dim signal is on, side
  // buttons drop to 30% and the center VOYO orb to 50% (orb stays
  // 20pp brighter — visible + accessible per the spec). Composed with
  // the existing --hold-* press vars via calc() so press-to-dim still
  // multiplies on top of ambient.
  const feedNavDim = usePlayerStore(s => s.feedNavDim);
  const sideAmbient = (voyoActiveTab === 'feed' && feedNavDim) ? 0.30 : 1;
  const orbAmbient  = (voyoActiveTab === 'feed' && feedNavDim) ? 0.50 : 1;
  // Lower-bound clamp on opacity so the press-dim × ambient-dim multiplier
  // can't drop below ~0.20 (≈ 0.084 in the worst case before — virtually
  // invisible buttons). The orb floor is higher (0.40) since it's the
  // primary action anchor and must always read as tappable.
  // (Audit §6 [251-255])
  const sideOpacity = `max(0.20, calc(var(--hold-side, 1) * ${sideAmbient}))`;
  const orbOpacity  = `max(0.40, calc(var(--hold-orb, 1) * ${orbAmbient}))`;
  const ambientTransition = 'opacity 1s cubic-bezier(0.16, 1, 0.3, 1)';
  const setVoyoTab = usePlayerStore(s => s.setVoyoTab);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const { dashId, isLoggedIn } = useAuth();

  const [promptState, setPromptState] = useState<'clean' | 'love' | 'keep'>('clean');
  const [promptCount, setPromptCount] = useState(0);
  const [unreadDMs, setUnreadDMs] = useState(0);

  // While pointer is down (scroll / hesitate / drag), dim side nav buttons
  // but keep the VOYO orb mostly visible — player anchor must stay accessible mid-gesture.
  // Imperative CSS vars instead of React state — zero re-renders per tap event.
  const holdNavRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = () => {
      holdNavRef.current?.style.setProperty('--hold-side', '0.28');
      holdNavRef.current?.style.setProperty('--hold-orb', '0.78');
    };
    const onUp = () => {
      holdNavRef.current?.style.setProperty('--hold-side', '1');
      holdNavRef.current?.style.setProperty('--hold-orb', '1');
    };
    document.addEventListener('pointerdown', onDown, { passive: true });
    document.addEventListener('pointerup', onUp, { passive: true });
    document.addEventListener('pointercancel', onUp, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, []);
  const holdTransition = 'opacity 280ms cubic-bezier(0.16, 1, 0.3, 1)';

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

    // rAF-dedup: the scroll event fires 60+ times per second on touch
    // devices. The original handler called setNavState on every event,
    // which round-tripped through React reconciliation at full frame
    // rate. Now we batch into one read + one state update per frame.
    let rafId: number | null = null;
    let latestEl: HTMLElement | null = null;

    const tick = () => {
      rafId = null;
      if (!latestEl || promptActiveRef.current) return;
      const el = latestEl;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      const pct = el.scrollTop / max;
      // Hysteresis — reveal at 88% (truly near the bottom), hide back
      // at 84% so the nav doesn't strobe right at the threshold.
      setNavState((prev) => {
        if (pct >= 0.88) return 'full';
        if (pct < 0.84) return 'fade';
        return prev;
      });
    };

    const onScroll = (e: Event) => {
      if (promptActiveRef.current) return;
      const target = e.target as HTMLElement | Document | null;
      latestEl = target instanceof Document
        ? document.documentElement
        : (target as HTMLElement | null);
      if (rafId == null) rafId = requestAnimationFrame(tick);
    };

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      if (rafId != null) cancelAnimationFrame(rafId);
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
      try {
        const count = await messagesAPI.getUnreadCount(dashId);
        setUnreadDMs(count);
      } catch { /* Supabase not configured or network error */ }
    };

    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);

    let subscription: ReturnType<typeof messagesAPI.subscribe> | null = null;
    try {
      subscription = messagesAPI.subscribe(dashId, () => {
        setUnreadDMs(prev => prev + 1);
      });
    } catch { /* Supabase not configured */ }

    return () => {
      clearInterval(interval);
      try { if (subscription) messagesAPI.unsubscribe(subscription); } catch {}
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
  // Tapping VOYO from anywhere always brings the player up — no flip-flop.
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
        ref={holdNavRef}
        className="pointer-events-auto max-w-[280px] mx-auto h-[54px] rounded-full flex items-center justify-around px-3"
        style={
          playerMode
            ? {
                background: 'transparent',
                border: 'none',
                boxShadow: 'none',
              }
            : {
                background: 'rgba(10, 10, 15, 0.65)',
                backdropFilter: 'blur(16px) saturate(150%)',
                WebkitBackdropFilter: 'blur(16px) saturate(150%)',
                border: '1px solid rgba(139, 92, 246, 0.08)',
                boxShadow: '0 4px 24px rgba(0,0,0,0.5), 0 0 20px rgba(139,92,246,0.04)',
              }
        }
      >
        {/* LEFT: HOME */}
        <button
          className="relative flex items-center justify-center flex-1 h-full"
          onPointerDown={() => handlePointerDown('home')}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onClick={handleHome}
          style={{ opacity: sideOpacity, transition: `${holdTransition}, ${ambientTransition}` }}
        >
          <div
            // Chip backplate — only when in playerMode and the wrapper is
            // transparent. Without it, the Home/Dahub icons floated invisibly
            // over dim album art (audit §6 [271-289]). 36px round chip with a
            // 10/10/15 wash + 1px hairline lifts the icons just enough to
            // find without re-introducing chrome around the wrapper.
            className="flex items-center justify-center"
            style={{
              transform: pressedBtn === 'home' ? 'scale(0.95)' : 'scale(1)',
              transition: 'transform 80ms ease-out',
              ...(playerMode
                ? {
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    background: 'rgba(10, 10, 15, 0.45)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    backdropFilter: 'blur(6px)',
                    WebkitBackdropFilter: 'blur(6px)',
                  }
                : {}),
            }}
          >
            <House
              size={20}
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
          style={{ flex: '0 0 auto', opacity: orbOpacity, transition: `${holdTransition}, ${ambientTransition}` }}
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
              // Bass pulse on the orb: scale(1 + bass*0.04). When pressed,
              // the scale override takes priority. When at rest, the orb
              // breathes with the kick drums.
              transform: pressedBtn === 'voyo'
                ? 'scale(1.08)'
                : 'scale(calc(1 + var(--voyo-bass, 0) * 0.04))',
              transition: 'border-radius 0.45s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              // AUDIO-REACTIVE ORB: bass energy from the frequency pump
              // adds a subtle scale boost on top of the ambient pulse.
              // --voyo-bass drives the scale, --voyo-energy drives the glow
              // intensity. Both fall to 0 when paused so the orb returns
              // to its resting CSS animation state naturally.
              // CSS animation + transform coexist — animation targets box-shadow (glow), not transform.
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
          style={{ opacity: sideOpacity, transition: `${holdTransition}, ${ambientTransition}` }}
        >
          <div
            // Mirror of the Home chip backplate — only painted in playerMode
            // when the wrapper itself is transparent. Same wash, same border.
            className="flex items-center justify-center"
            style={{
              transform: pressedBtn === 'dahub' ? 'scale(0.95)' : 'scale(1)',
              transition: 'transform 80ms ease-out',
              ...(playerMode
                ? {
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    background: 'rgba(10, 10, 15, 0.45)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    backdropFilter: 'blur(6px)',
                    WebkitBackdropFilter: 'blur(6px)',
                  }
                : {}),
            }}
          >
            <div className="relative">
              <ChatCircle
                size={20}
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
