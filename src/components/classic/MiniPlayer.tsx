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
  const cycleRepeat = usePlayerStore(s => s.cycleRepeat);
  const { handlePlayPause } = useMobilePlay();
  const [shouldScroll, setShouldScroll] = useState(false);
  const [showBubbles, setShowBubbles] = useState(false);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  // Seek bar 4-phase choreography on tap (purple1 → bloom → purple2 → idle bronze)
  type BarPhase = 'idle' | 'purple1' | 'bloom' | 'purple2';
  const [barPhase, setBarPhase] = useState<BarPhase>('idle');
  const phaseTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  // Takeout bubble flips purple → orange on tap (confirms takeout armed).
  // Resets when bubbles auto-hide so a fresh tap starts purple.
  const [takenOut, setTakenOut] = useState(false);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const lastTapRef = useRef<number>(0);

  const revealBar = useCallback(() => {
    phaseTimersRef.current.forEach(clearTimeout);
    phaseTimersRef.current = [];
    setBarPhase('purple1');
    phaseTimersRef.current.push(setTimeout(() => setBarPhase('bloom'), 3000));
    phaseTimersRef.current.push(setTimeout(() => setBarPhase('purple2'), 8000));
    phaseTimersRef.current.push(setTimeout(() => setBarPhase('idle'), 15000));
  }, []);
  useEffect(() => () => {
    phaseTimersRef.current.forEach(clearTimeout);
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

  // Bubbles auto-hide. Reset takenOut when they go away so the next tap
  // starts purple again.
  useEffect(() => {
    if (showBubbles) {
      const timer = setTimeout(() => setShowBubbles(false), 3000);
      return () => clearTimeout(timer);
    }
    setTakenOut(false);
  }, [showBubbles]);

  if (!currentTrack) return null;

  const wrapperClass =
    variant === 'docked'
      ? 'absolute bottom-24 left-4 right-4 z-40'
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

          {/* Takeout — purple → orange on tap (PiP arm) */}
          <button
            className={`w-12 h-12 rounded-full backdrop-blur-xl flex items-center justify-center shadow-lg active:scale-95 transition-all duration-300 border-2 ${
              takenOut
                ? 'bg-gradient-to-br from-orange-500/85 to-amber-600/85 border-orange-400'
                : 'bg-gradient-to-br from-purple-500/80 to-violet-600/80 border-purple-400'
            }`}
            aria-label={takenOut ? 'Taken Out — playing in floating cube' : 'Take Out — keep playing in floating cube'}
            onClick={(e) => {
              e.stopPropagation();
              setTakenOut(true);
              void pipService.enter().catch(() => { /* MediaSession is the fallback */ });
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
        {/* Seek bar — 4-phase reveal, bass-reactive bronze at rest. */}
        <div
          className="absolute bottom-1 left-2 right-2 h-1 overflow-hidden rounded-full"
          style={{
            background:
              barPhase === 'idle'
                ? 'rgba(212,160,83, calc(0.19 + var(--voyo-bass, 0) * 0.25))'
                : barPhase === 'bloom'
                ? 'linear-gradient(90deg, rgba(139,92,246,0.40) 0%, rgba(236,72,153,0.40) 50%, rgba(251,146,60,0.40) 100%)'
                : 'rgba(139,92,246,0.28)',
            transition: 'background 350ms ease-out',
          }}
        >
          <div className="h-full relative" style={{ width: `${progress}%` }}>
            <div
              className="absolute inset-0"
              style={{
                background:
                  barPhase === 'idle'
                    ? 'rgba(212,160,83,0.47)'
                    : barPhase === 'bloom'
                    ? 'linear-gradient(90deg, #8b5cf6 0%, #ec4899 50%, #fb923c 100%)'
                    : '#8b5cf6',
                transition: 'background 350ms ease-out',
              }}
            />
            <div
              className="absolute right-0 top-0 bottom-0 w-4"
              style={{
                background:
                  barPhase === 'idle'
                    ? 'linear-gradient(to left, rgba(212,160,83,0.38), transparent)'
                    : barPhase === 'bloom'
                    ? 'linear-gradient(to left, rgba(251,146,60,0.7), transparent)'
                    : 'linear-gradient(to left, rgba(139,92,246,0.7), transparent)',
                transition: 'background 350ms ease-out',
              }}
            />
          </div>
        </div>

        {/* Thumbnail */}
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

      {/* Marquee animation */}
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
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
