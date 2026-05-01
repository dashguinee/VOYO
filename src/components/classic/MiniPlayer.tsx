/**
 * VOYO Music — MiniPlayer
 *
 * The persistent player chrome. Same component is rendered at the bottom
 * of Classic Home (above the bottom nav) AND inside the expanded
 * NowPlaying view as the consistent control surface — so user never has
 * to relearn which button does what.
 *
 * Behaviors:
 * - Single tap → reveal seek bar + 3 floating bubbles (Shuffle, Repeat, Takeout)
 * - Double tap → onOpenFull() — Home: opens NowPlaying; NowPlaying: opens VOYO
 * - Swipe left/right → next/prev track
 * - Seek bar → 4-phase reveal (purple1 → bloom → purple2 → bronze rest);
 *   bronze rest pulses with --voyo-bass for a subtle music-reactive ambience
 *   on bass-heavy tracks (afrobeats, amapiano, drill).
 *
 * Extracted from ClassicMode.tsx (v934) so NowPlaying can use the same
 * chrome without duplicating ~280 lines of state + behavior.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Shuffle, Repeat, Repeat1, PictureInPicture2 } from 'lucide-react';
import { usePlayerStore } from '../../store/playerStore';
import { pipService } from '../../services/pipService';
import { getYouTubeThumbnail } from '../../data/tracks';
import { SmartImage } from '../ui/SmartImage';
import { PlaylistModal } from '../playlist/PlaylistModal';
import { OyeButton } from '../oye/OyeButton';
import { useMobilePlay } from '../../hooks/useMobilePlay';

interface MiniPlayerProps {
  /** Double-tap action. Home → opens NowPlaying. NowPlaying → opens VOYO. */
  onOpenFull: () => void;
  /**
   * Layout mode.
   * - 'docked' (default): position: absolute, bottom-24 left-4 right-4 z-40 — sits above the
   *   classic bottom nav.
   * - 'inline': no positional class — caller positions the chrome (e.g., NowPlaying
   *   anchors it at the bottom of its layout).
   */
  variant?: 'docked' | 'inline';
}

export const MiniPlayer = ({ onOpenFull, variant = 'docked' }: MiniPlayerProps) => {
  // Battery fix: fine-grained selectors — progress updates every second
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const progress = usePlayerStore(s => s.progress);
  const nextTrack = usePlayerStore(s => s.nextTrack);
  const prevTrack = usePlayerStore(s => s.prevTrack);
  const shuffleMode = usePlayerStore(s => s.shuffleMode);
  const repeatMode = usePlayerStore(s => s.repeatMode);
  const toggleShuffle = usePlayerStore(s => s.toggleShuffle);
  const playerCompact = usePlayerStore(s => s.playerCompact);
  const cycleRepeat = usePlayerStore(s => s.cycleRepeat);
  const { handlePlayPause } = useMobilePlay();
  const [shouldScroll, setShouldScroll] = useState(false);
  const [showBubbles, setShowBubbles] = useState(false);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  // v939 — Seek bar reverted to the simple two-state model:
  //   idle  → bronze (bass-reactive via --voyo-bass)
  //   revealed → bold purple, 15s window after a tap, then ease back
  // The purple→pink→orange morph that was here moved to the Takeout
  // bubble where it belongs as a state-confirmation cue.
  const [barRevealed, setBarRevealed] = useState(false);
  const barRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // v939 — Takeout bubble: subscribes to pipService active state so it
  // shows orange whenever PiP is live (across bubble re-opens, and clears
  // when user closes PiP from system UI). Local takeoutArming flag covers
  // the brief window between tap and pipService.setActive callback.
  const [pipActive, setPipActive] = useState<boolean>(() => pipService.isActive());
  const [takeoutArming, setTakeoutArming] = useState(false);
  const takenOut = pipActive || takeoutArming;
  const titleRef = useRef<HTMLParagraphElement>(null);
  const lastTapRef = useRef<number>(0);

  const revealBar = useCallback(() => {
    setBarRevealed(true);
    if (barRevealTimerRef.current) clearTimeout(barRevealTimerRef.current);
    barRevealTimerRef.current = setTimeout(() => setBarRevealed(false), 15000);
  }, []);
  useEffect(() => () => {
    if (barRevealTimerRef.current) clearTimeout(barRevealTimerRef.current);
  }, []);

  // Live PiP-active subscription. When PiP enters → orange persists.
  // When user closes PiP (system UI tap) → button reverts to purple.
  useEffect(() => {
    const unsub = pipService.subscribeActive((active) => {
      setPipActive(active);
      if (active) setTakeoutArming(false);
    });
    return unsub;
  }, []);

  // Double-tap detection. 200ms window — comfortably above human floor (~150ms),
  // reads as immediate.
  const handleTap = useCallback(() => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 200;
    revealBar();
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      onOpenFull();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
      setTimeout(() => {
        if (Date.now() - lastTapRef.current >= DOUBLE_TAP_DELAY) {
          setShowBubbles(prev => !prev);
        }
      }, DOUBLE_TAP_DELAY);
    }
  }, [onOpenFull, revealBar]);

  // Title scroll detection
  useEffect(() => {
    if (titleRef.current) {
      setShouldScroll(titleRef.current.scrollWidth > titleRef.current.clientWidth);
    }
  }, [currentTrack?.title]);

  // Swipe gestures via native pointer events
  const swipeStartRef = useRef<{ x: number; t: number } | null>(null);
  const swipeFiredRef = useRef(false);

  const handleSwipeDown = useCallback((e: React.PointerEvent) => {
    swipeStartRef.current = { x: e.clientX, t: Date.now() };
    swipeFiredRef.current = false;
  }, []);

  const handleSwipeUp = useCallback((e: React.PointerEvent) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const elapsed = Date.now() - start.t;
    const velocity = Math.abs(dx) / Math.max(1, elapsed);
    const threshold = 80;
    if (Math.abs(dx) > threshold || (velocity > 0.5 && Math.abs(dx) > 30)) {
      swipeFiredRef.current = true; // eat the trailing click
      if (dx < 0) nextTrack();
      else prevTrack();
    }
  }, [nextTrack, prevTrack]);

  // Bubbles auto-hide after 3s. Takeout state is driven by real PiP-active
  // (subscribed above) so we don't reset it here — it persists exactly as
  // long as PiP itself.
  useEffect(() => {
    if (showBubbles) {
      const timer = setTimeout(() => setShowBubbles(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showBubbles]);

  if (!currentTrack) return null;

  // When search is open (playerCompact), switch to fixed so it floats above
  // the search backdrop (z-[65]). z-[68] = above backdrop, below search content (z-[70]).
  const wrapperClass =
    variant === 'docked'
      ? playerCompact
        ? 'fixed bottom-24 left-4 right-4 z-[68]'
        : 'absolute bottom-24 left-4 right-4 z-40'
      : 'relative w-full';

  return (
    <div className={wrapperClass}>
      {/* Floating Bubble Controls */}
      {showBubbles && (
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 flex items-center gap-4 z-50">
          {/* Shuffle */}
          <button
            className={`w-12 h-12 rounded-full backdrop-blur-xl flex items-center justify-center shadow-lg active:scale-95 transition-transform ${
              shuffleMode
                ? 'bg-purple-500/80 border-2 border-purple-400'
                : 'bg-[#1c1c22] border border-[#28282f]'
            }`}
            aria-label={shuffleMode ? 'Disable shuffle' : 'Enable shuffle'}
            onClick={(e) => { e.stopPropagation(); toggleShuffle(); }}
          >
            <Shuffle className={`w-5 h-5 ${shuffleMode ? 'text-white' : 'text-white/70'}`} />
          </button>

          {/* Repeat */}
          <button
            className={`w-12 h-12 rounded-full backdrop-blur-xl flex items-center justify-center shadow-lg active:scale-95 transition-transform ${
              repeatMode !== 'off'
                ? 'bg-purple-500/80 border-2 border-purple-400'
                : 'bg-[#1c1c22] border border-[#28282f]'
            }`}
            aria-label={
              repeatMode === 'off'
                ? 'Enable repeat'
                : repeatMode === 'one'
                ? 'Repeat one, click to change'
                : 'Repeat all, click to change'
            }
            onClick={(e) => { e.stopPropagation(); cycleRepeat(); }}
          >
            {repeatMode === 'one' ? (
              <Repeat1 className="w-5 h-5 text-white" />
            ) : (
              <Repeat className={`w-5 h-5 ${repeatMode === 'all' ? 'text-white' : 'text-white/70'}`} />
            )}
            {repeatMode !== 'off' && (
              <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-purple-400 text-[8px] font-bold text-white flex items-center justify-center">
                {repeatMode === 'one' ? '1' : '∞'}
              </div>
            )}
          </button>

          {/* Takeout — purple → pink → orange morph on tap, settles at orange
              while PiP is active (subscribed via pipService.subscribeActive).
              The morph plays during the takeoutArming window (request in
              flight); pipActive=true takes over once PiP is confirmed and
              keeps the orange persisting across bubble re-opens / until the
              user closes PiP from system UI. */}
          <button
            className={`w-12 h-12 rounded-full backdrop-blur-xl flex items-center justify-center shadow-lg active:scale-95 border-2 ${
              takenOut
                ? 'voyo-takeout-active border-orange-400'
                : 'bg-gradient-to-br from-purple-500/80 to-violet-600/80 border-purple-400 transition-all duration-300'
            }`}
            style={
              takeoutArming
                ? { animation: 'voyo-takeout-bloom 1000ms cubic-bezier(0.16, 1, 0.3, 1) forwards' }
                : undefined
            }
            aria-label={takenOut ? 'Taken Out — playing in floating cube' : 'Take Out — keep playing in floating cube'}
            onClick={(e) => {
              e.stopPropagation();
              if (takenOut) {
                // Already PiP-active → tap exits PiP.
                void pipService.exit().catch(() => { /* swallow */ });
                return;
              }
              setTakeoutArming(true);
              void pipService.enter().catch(() => {
                // Failed to enter PiP — drop the arming state so the button
                // doesn't stay stuck mid-morph.
                setTakeoutArming(false);
              });
            }}
          >
            <PictureInPicture2 className="w-5 h-5 text-white" />
          </button>
        </div>
      )}

      <div
        className="w-full flex items-center gap-2.5 p-2 pr-3 rounded-2xl border backdrop-blur-xl shadow-2xl relative overflow-hidden cursor-pointer"
        style={{
          background: 'rgba(28, 28, 35, 0.65)',
          borderColor: 'rgba(139, 92, 246, 0.12)',
          touchAction: 'pan-y',
        }}
        onClick={() => { if (swipeFiredRef.current) { swipeFiredRef.current = false; return; } handleTap(); }}
        onPointerDown={handleSwipeDown}
        onPointerUp={handleSwipeUp}
        onPointerCancel={() => { swipeStartRef.current = null; }}
      >
        {/* Seek bar — v939 simple two-state. Bronze rest is bass-reactive
            via --voyo-bass (warm room rhythm on hot tracks, near-silent on
            chill). On tap: whole bar → bold purple for 15s, then 350ms
            fade back. The morph spectrum lives on the Takeout bubble now. */}
        <div
          className="absolute bottom-1 left-2 right-2 h-1 overflow-hidden rounded-full"
          style={{
            background: barRevealed
              ? 'rgba(139,92,246,0.28)'
              : 'rgba(212,160,83, calc(0.19 + var(--voyo-bass, 0) * 0.25))',
            transition: 'background 350ms ease-out',
          }}
        >
          <div className="h-full relative" style={{ width: `${progress}%` }}>
            <div
              className="absolute inset-0"
              style={{
                background: barRevealed ? '#8b5cf6' : 'rgba(212,160,83,0.47)',
                transition: 'background 350ms ease-out',
              }}
            />
            <div
              className="absolute right-0 top-0 bottom-0 w-4"
              style={{
                background: barRevealed
                  ? 'linear-gradient(to left, rgba(139,92,246,0.7), transparent)'
                  : 'linear-gradient(to left, rgba(212,160,83,0.38), transparent)',
                transition: 'background 350ms ease-out',
              }}
            />
          </div>
        </div>

        {/* Thumbnail + Info — keyed so they re-mount and fade in on track change */}
        <div key={currentTrack.trackId} className="flex items-center gap-2.5 flex-1 min-w-0 voyo-miniplayer-card-arrive">
          <div className="relative w-12 h-12 rounded-xl overflow-hidden flex-shrink-0">
            <SmartImage
              src={getYouTubeThumbnail(currentTrack.trackId, 'medium')}
              alt={`${currentTrack.title} by ${currentTrack.artist}`}
              className="w-full h-full object-cover"
              trackId={currentTrack.trackId}
              artist={currentTrack.artist}
              title={currentTrack.title}
            />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 text-left overflow-hidden">
            <div className="overflow-hidden">
              <p
                ref={titleRef}
                className={`text-white font-medium text-sm whitespace-nowrap ${shouldScroll ? 'animate-marquee' : 'truncate'}`}
                style={shouldScroll ? { animation: 'marquee 8s linear infinite' } : {}}
              >
                {currentTrack.title}
                {shouldScroll && <span className="mx-8">{currentTrack.title}</span>}
              </p>
            </div>
            <p className="text-white/50 text-xs truncate">{currentTrack.artist}</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0" style={{ marginRight: '4px' }}>
          <button
            className="rounded-full bg-white/10 flex items-center justify-center min-w-[44px] min-h-[44px] active:scale-95 transition-transform"
            aria-label="Add to playlist"
            onClick={(e) => { e.stopPropagation(); setShowPlaylistModal(true); }}
          >
            <Plus className="w-3.5 h-3.5 text-white" />
          </button>

          <OyeButton track={currentTrack} size="lg" />

          <button
            className="w-11 h-11 rounded-full bg-white flex items-center justify-center active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c]"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            onClick={(e) => { e.stopPropagation(); handlePlayPause(e); }}
          >
            {isPlaying ? (
              <div className="flex gap-1">
                <div className="w-1 h-4 bg-black rounded-full" />
                <div className="w-1 h-4 bg-black rounded-full" />
              </div>
            ) : (
              <div className="w-0 h-0 border-l-[10px] border-l-black border-y-[6px] border-y-transparent ml-1" />
            )}
          </button>
        </div>
      </div>

      {/* Marquee + Takeout bloom animations */}
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        /* v939 — Takeout bubble morph: purple → pink → orange. Browsers
           interpolate between gradients of the same form (linear-gradient,
           same stop count, same color-space format) so the transition
           sweeps through the spectrum smoothly. forwards fill keeps the
           button at orange after the animation completes. */
        @keyframes voyo-takeout-bloom {
          0%   { background: linear-gradient(135deg, rgba(168,85,247,0.85) 0%, rgba(124,58,237,0.85) 100%); }
          45%  { background: linear-gradient(135deg, rgba(236,72,153,0.85) 0%, rgba(244,114,182,0.85) 100%); }
          100% { background: linear-gradient(135deg, rgba(249,115,22,0.85) 0%, rgba(234,88,12,0.85) 100%); }
        }
        /* Steady-state orange while PiP is active. Same end-color as the
           bloom keyframe's 100% so there's no visible step when the
           animation completes and pipActive flips this class on. */
        .voyo-takeout-active {
          background: linear-gradient(135deg, rgba(249,115,22,0.85) 0%, rgba(234,88,12,0.85) 100%);
          transition: background 250ms ease-out;
        }
      `}</style>

      {currentTrack && (
        <PlaylistModal
          isOpen={showPlaylistModal}
          onClose={() => setShowPlaylistModal(false)}
          trackId={currentTrack.trackId || currentTrack.id}
          trackTitle={currentTrack.title}
        />
      )}
    </div>
  );
};

export default MiniPlayer;
