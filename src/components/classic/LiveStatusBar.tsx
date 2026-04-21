/**
 * LiveStatusBar — takes the slot the GreetingBanner vacates and tells
 * the tale of what's happening in the app right now. Ambient, not
 * shouty: one short contextual line with a pulsing bronze dot, fades
 * between states as the story changes, stays out of the way.
 *
 * Priority of tales (highest first — first truthy wins):
 *   1. "Now playing X by Y" (when something IS playing)
 *   2. "N tracks warming up" (queue + upcoming prewarms)
 *   3. "Your session is deep — N tracks in" (after some history)
 *   4. "Pool refreshed — fresh afro heat" (after a pool bump)
 *   5. "OYO is curating around <artist>" (recent favorite)
 *   6. Default: "VOYO is live"
 *
 * The bar text auto-refreshes when relevant state changes, and gently
 * rotates through alternate tales every ROTATION_MS so it doesn't feel
 * frozen when playing a single track for a while.
 */

import { useEffect, useMemo, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';

const ROTATION_MS = 8_000;

interface Tale {
  key: string;
  text: string;
}

function getTales(state: {
  currentTrack: { title?: string; artist?: string } | null;
  isPlaying: boolean;
  queueLen: number;
  historyLen: number;
}): Tale[] {
  const tales: Tale[] = [];
  const t = state.currentTrack;

  if (t && state.isPlaying && t.title && t.artist) {
    tales.push({
      key: 'playing',
      text: `Now playing · ${t.title} — ${t.artist}`,
    });
  } else if (t && t.title && t.artist) {
    tales.push({
      key: 'paused',
      text: `Paused · ${t.title} — ${t.artist}`,
    });
  }

  if (state.queueLen > 0) {
    tales.push({
      key: 'queue',
      text: state.queueLen === 1
        ? `1 track warming up`
        : `${state.queueLen} tracks warming up`,
    });
  }

  if (state.historyLen >= 5) {
    tales.push({
      key: 'session',
      text: `Session deep · ${state.historyLen} tracks in`,
    });
  }

  // Always-available fallback. Rotates in if nothing more specific.
  tales.push({ key: 'live', text: 'VOYO is live' });

  return tales;
}

export const LiveStatusBar = () => {
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const queue = usePlayerStore(s => s.queue);
  const history = usePlayerStore(s => s.history);

  const tales = useMemo(() => getTales({
    currentTrack,
    isPlaying,
    queueLen: queue?.length ?? 0,
    historyLen: history?.length ?? 0,
  }), [currentTrack, isPlaying, queue, history]);

  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(false);

  // Graceful fade-in on mount — the greeting just left, so we ease in.
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 140);
    return () => clearTimeout(t);
  }, []);

  // Rotate between tales so the bar breathes even on a long single track.
  useEffect(() => {
    if (tales.length <= 1) return;
    const id = window.setInterval(() => {
      setIdx(i => (i + 1) % tales.length);
    }, ROTATION_MS);
    return () => clearInterval(id);
  }, [tales.length]);

  // If the tales list shrinks, keep idx valid.
  useEffect(() => {
    if (idx >= tales.length) setIdx(0);
  }, [idx, tales.length]);

  // Reset rotation when the set of tales CHANGES so the new one is shown.
  useEffect(() => { setIdx(0); }, [tales.map(t => t.key).join('|')]);

  const tale = tales[idx] ?? tales[0];

  return (
    <div
      className="px-4 pt-2 pb-4 pointer-events-none"
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 420ms ease',
      }}
    >
      <div className="flex items-center gap-2 text-[12px] text-white/55">
        {/* Pulsing bronze dot — "live" indicator. */}
        <span
          className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{
            background: '#D4A053',
            boxShadow: '0 0 8px rgba(212,160,83,0.75)',
            animation: 'voyo-status-pulse 2400ms ease-in-out infinite',
          }}
        />
        {/* Tale line — keyed so each swap fades in. */}
        <span
          key={tale.key}
          className="truncate"
          style={{
            animation: 'voyo-status-tale-in 420ms ease both',
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
