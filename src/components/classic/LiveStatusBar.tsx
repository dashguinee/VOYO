/**
 * LiveStatusBar — event-driven tale layer in the top-of-feed slot.
 *
 * Doesn't persist. Fades IN when there's something meaningful to say,
 * holds for a few seconds, fades OUT and disappears. Shows nothing
 * when the app has no story to tell.
 *
 * Current event types (each is a candidate tale):
 *   · play          — track just started                (on currentTrack change)
 *   · next-up       — queue has an upcoming track       (on queue change)
 *   · milestone     — session-listen milestones (5/10/25/50/100)
 *   · trending      — artist from hot pool (periodic tap)
 *   · fresh         — discovery pool has fresh picks    (periodic tap)
 *
 * The bar surfaces one tale at a time, keyed so React animates the swap.
 * After HOLD_MS with no new event, it fades out and renders nothing.
 */

import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { useTrackPoolStore } from '../../store/trackPoolStore';

const HOLD_MS = 4600;           // how long a tale sits before fading
const TRENDING_REBEAT_MS = 28_000; // periodic trending/fresh pulse
const MIN_GAP_MS = 900;         // don't flap faster than this

interface Tale {
  id: string;         // changing this re-triggers the CSS enter animation
  text: string;
  accent?: 'bronze' | 'purple' | 'emerald';
}

export const LiveStatusBar = () => {
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const queue = usePlayerStore(s => s.queue);
  const history = usePlayerStore(s => s.history);
  const hotPool = useTrackPoolStore(s => s.hotPool);

  const [tale, setTale] = useState<Tale | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const lastEmitRef = useRef(0);

  const emit = (t: Tale) => {
    const now = Date.now();
    if (now - lastEmitRef.current < MIN_GAP_MS) return;
    lastEmitRef.current = now;
    if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
    setTale(t);
    setVisible(true);
    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false);
      // Fully unmount after the fade-out finishes so layout collapses.
      window.setTimeout(() => setTale(null), 440);
    }, HOLD_MS);
  };

  // Track change → "Now playing" tale
  const prevTrackRef = useRef<string | null>(null);
  useEffect(() => {
    const t = currentTrack;
    if (!t || !t.trackId || !t.title || !t.artist) return;
    if (prevTrackRef.current === t.trackId) return;
    prevTrackRef.current = t.trackId;
    emit({
      id: `play-${t.trackId}`,
      text: `Now playing · ${t.title} — ${t.artist}`,
      accent: 'bronze',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.trackId]);

  // Queue gained a head → "Next up" tale (only fires when queue[0] is new)
  const prevQueueHeadRef = useRef<string | null>(null);
  useEffect(() => {
    const head = queue?.[0]?.track;
    const headId = head?.trackId ?? null;
    if (!headId) { prevQueueHeadRef.current = null; return; }
    if (prevQueueHeadRef.current === headId) return;
    prevQueueHeadRef.current = headId;
    if (!head?.title || !head?.artist) return;
    emit({
      id: `next-${headId}`,
      text: `Next up · ${head.title} — ${head.artist}`,
      accent: 'purple',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  // Session milestones at 5 / 10 / 25 / 50 / 100 tracks-in
  const milestonesEmittedRef = useRef(new Set<number>());
  useEffect(() => {
    const n = history?.length ?? 0;
    const milestones = [5, 10, 25, 50, 100];
    for (const m of milestones) {
      if (n >= m && !milestonesEmittedRef.current.has(m)) {
        milestonesEmittedRef.current.add(m);
        emit({
          id: `milestone-${m}`,
          text: `Session deep · ${m} tracks in`,
          accent: 'emerald',
        });
        break;
      }
    }
  }, [history]);

  // Periodic trending / fresh-drop pulse from the hot pool — if nothing
  // else is happening, surface what's hot. Picks the top-scored artist
  // the user hasn't heard the default line for recently.
  useEffect(() => {
    if (!hotPool || hotPool.length === 0) return;
    const top = hotPool[0];
    const artist = top?.artist;
    if (!artist) return;
    // One kickoff after ~8s on mount, then repeat every TRENDING_REBEAT_MS.
    let kickoff: number | null = null;
    let interval: number | null = null;
    kickoff = window.setTimeout(() => {
      emit({
        id: `trend-${artist}-${Date.now()}`,
        text: `Trending · ${artist}`,
        accent: 'bronze',
      });
      interval = window.setInterval(() => {
        // Re-pick in case pool shifted.
        const a = (useTrackPoolStore.getState().hotPool?.[0]?.artist) || artist;
        emit({
          id: `trend-${a}-${Date.now()}`,
          text: `Trending · ${a}`,
          accent: 'bronze',
        });
      }, TRENDING_REBEAT_MS);
    }, 8_000);
    return () => {
      if (kickoff != null) window.clearTimeout(kickoff);
      if (interval != null) window.clearInterval(interval);
    };
  }, [hotPool.length]);

  // Cleanup stranded timers on unmount.
  useEffect(() => () => {
    if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
  }, []);

  if (!tale) return null;

  const dotColor =
    tale.accent === 'purple' ? '#a78bfa'
    : tale.accent === 'emerald' ? '#6ee7b7'
    : '#D4A053';

  const dotShadow =
    tale.accent === 'purple' ? 'rgba(167,139,250,0.75)'
    : tale.accent === 'emerald' ? 'rgba(110,231,183,0.7)'
    : 'rgba(212,160,83,0.75)';

  return (
    <div
      className="px-4 pt-2 pb-3 pointer-events-none"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(-4px)',
        transition: 'opacity 420ms ease, transform 420ms ease',
      }}
    >
      <div className="flex items-center gap-2 text-[12px] text-white/55">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{
            background: dotColor,
            boxShadow: `0 0 8px ${dotShadow}`,
            animation: 'voyo-status-pulse 2400ms ease-in-out infinite',
          }}
        />
        <span
          key={tale.id}
          className="truncate"
          style={{
            animation: 'voyo-status-tale-in 360ms ease both',
            letterSpacing: '0.01em',
          }}
        >
          {tale.text}
        </span>
      </div>

      <style>{`
        @keyframes voyo-status-pulse {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50%      { opacity: 1;    transform: scale(1.15); }
        }
        @keyframes voyo-status-tale-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default LiveStatusBar;
