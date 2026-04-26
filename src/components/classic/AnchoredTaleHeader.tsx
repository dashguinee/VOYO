/**
 * AnchoredTaleHeader — single dot-anchored surface that absorbs both
 * the static "Oyé We Live" header and the rolling LiveStatusBar tales.
 *
 * Two layers, one dot:
 *   ANCHOR  — "Oyé We Live", full-size bold text, sitting beside the
 *             dot. Visible most of the time. Reserved for major-event
 *             swaps (currently only session milestones replace it).
 *   WHISPER — small 60%-size tale beneath the anchor. Rises from the
 *             dot (transform-origin: left + scaleX, opacity, slight
 *             upward translate). Holds 2s. Retracts back into the
 *             dot. Used for "Now playing", "Next up", "Trending".
 *
 * The dot is the visual anchor for both layers. It scales subtly on
 * any tale activity so the compound feels like one organism.
 *
 * Replaces both the LiveStatusBar (in GreetingArea) and the static
 * "Oyé! We Live" header that lived inside VoyoLiveCard.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { useTrackPoolStore } from '../../store/trackPoolStore';

const HOLD_MS = 4000;
const FADE_MS = 380;
const MIN_GAP_MS = 1200;       // whispers don't flap faster than this
const TRENDING_REBEAT_MS = 28_000;
const ANCHOR_RESTORE_MS = 4500; // a major tale holds longer before anchor restores

type Accent = 'bronze' | 'purple' | 'emerald' | 'orange';
type Severity = 'whisper' | 'major';

interface Tale {
  id: string;
  text: string;
  accent: Accent;
  severity: Severity;
  hold?: number;
}

const ACCENTS: Record<Accent, { bg: string; halo: string; shadow: string; text: string }> = {
  bronze:  { bg: 'linear-gradient(135deg, #FBBF77 0%, #D4A053 100%)', halo: 'rgba(212,160,83,0.6)',  shadow: 'rgba(212,160,83,0.7)', text: 'rgba(244,194,131,0.78)' },
  purple:  { bg: 'linear-gradient(135deg, #C4B5FD 0%, #A78BFA 100%)', halo: 'rgba(167,139,250,0.6)', shadow: 'rgba(167,139,250,0.7)', text: 'rgba(196,181,253,0.78)' },
  emerald: { bg: 'linear-gradient(135deg, #4FE8A7 0%, #2DB785 100%)', halo: 'rgba(61,220,151,0.55)', shadow: 'rgba(61,220,151,0.6)',  text: 'rgba(110,231,183,0.78)' },
  orange:  { bg: 'linear-gradient(135deg, #FDBA74 0%, #F97316 100%)', halo: 'rgba(249,115,22,0.6)',  shadow: 'rgba(249,115,22,0.7)',  text: 'rgba(251,191,119,0.78)' },
};

export const AnchoredTaleHeader = () => {
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const queue = usePlayerStore(s => s.queue);
  const history = usePlayerStore(s => s.history);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const hotPool = useTrackPoolStore(s => s.hotPool);

  // Whisper layer state
  const [whisper, setWhisper] = useState<Tale | null>(null);
  const [whisperVisible, setWhisperVisible] = useState(false);
  const whisperTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lastEmitRef = useRef(0);

  // Major-event swap state (replaces anchor temporarily)
  const [anchorOverride, setAnchorOverride] = useState<Tale | null>(null);
  const overrideTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearWhisperTimers = useCallback(() => {
    whisperTimersRef.current.forEach(clearTimeout);
    whisperTimersRef.current = [];
  }, []);
  const clearOverrideTimers = useCallback(() => {
    overrideTimersRef.current.forEach(clearTimeout);
    overrideTimersRef.current = [];
  }, []);

  const playTale = useCallback((t: Tale) => {
    const now = Date.now();
    if (now - lastEmitRef.current < MIN_GAP_MS) return;
    lastEmitRef.current = now;

    if (t.severity === 'major') {
      clearOverrideTimers();
      setAnchorOverride(t);
      const hold = t.hold ?? ANCHOR_RESTORE_MS;
      overrideTimersRef.current.push(setTimeout(() => setAnchorOverride(null), hold));
    } else {
      clearWhisperTimers();
      setWhisper(t);
      setWhisperVisible(false); // commit hidden so the next frame can transition
      // tiny rAF to ensure transition fires
      whisperTimersRef.current.push(setTimeout(() => setWhisperVisible(true), 16));
      const hold = t.hold ?? HOLD_MS;
      whisperTimersRef.current.push(setTimeout(() => setWhisperVisible(false), 16 + hold));
      whisperTimersRef.current.push(setTimeout(() => setWhisper(null), 16 + hold + FADE_MS));
    }
  }, [clearWhisperTimers, clearOverrideTimers]);

  // ── Track change → "Now playing" whisper ─────────────────────────
  const prevTrackRef = useRef<string | null>(null);
  useEffect(() => {
    const t = currentTrack;
    if (!t || !t.trackId || !t.title || !t.artist) return;
    if (prevTrackRef.current === t.trackId) return;
    prevTrackRef.current = t.trackId;
    playTale({ id: `play-${t.trackId}`, severity: 'whisper', text: `Now playing · ${t.title} — ${t.artist}`, accent: 'bronze' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.trackId]);

  // ── Queue head change → "Next up" whisper ─────────────────────────
  const prevQueueHeadRef = useRef<string | null>(null);
  useEffect(() => {
    const head = queue?.[0]?.track;
    const headId = head?.trackId ?? null;
    if (!headId) { prevQueueHeadRef.current = null; return; }
    if (prevQueueHeadRef.current === headId) return;
    prevQueueHeadRef.current = headId;
    if (!head?.title || !head?.artist) return;
    playTale({ id: `next-${headId}`, severity: 'whisper', text: `Next up · ${head.title} — ${head.artist}`, accent: 'purple' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  // ── Session milestones → MAJOR (replaces "Oyé We Live" anchor) ───
  const milestonesEmittedRef = useRef(new Set<number>());
  useEffect(() => {
    const n = history?.length ?? 0;
    const milestones = [5, 10, 25, 50, 100];
    for (const m of milestones) {
      if (n >= m && !milestonesEmittedRef.current.has(m)) {
        milestonesEmittedRef.current.add(m);
        playTale({ id: `milestone-${m}`, severity: 'major', text: `Session deep · ${m} in`, accent: 'emerald' });
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history?.length]);

  // ── Trending pulse — kickoff after 8s, repeat every TRENDING_REBEAT_MS
  useEffect(() => {
    if (!hotPool || hotPool.length === 0) return;
    const top = hotPool[0];
    const artist = top?.artist;
    if (!artist) return;
    let kickoff: ReturnType<typeof setTimeout> | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    kickoff = setTimeout(() => {
      playTale({ id: `trend-${artist}-${Date.now()}`, severity: 'whisper', text: `Trending · ${artist}`, accent: 'bronze' });
      interval = setInterval(() => {
        const a = (useTrackPoolStore.getState().hotPool?.[0]?.artist) || artist;
        playTale({ id: `trend-${a}-${Date.now()}`, severity: 'whisper', text: `Trending · ${a}`, accent: 'bronze' });
      }, TRENDING_REBEAT_MS);
    }, 8_000);
    return () => {
      if (kickoff) clearTimeout(kickoff);
      if (interval) clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotPool?.length]);

  useEffect(() => () => { clearWhisperTimers(); clearOverrideTimers(); }, [clearWhisperTimers, clearOverrideTimers]);

  // Resolve current display
  const playingAccent: Accent = isPlaying ? 'orange' : 'emerald';
  const anchorText = anchorOverride?.text ?? 'Oyé We Live';
  const anchorAccent: Accent = anchorOverride?.accent ?? playingAccent;
  const anchorColors = ACCENTS[anchorAccent];

  // Dot scales up subtly while a whisper is rising or while a major
  // override is active — signals "something's happening"
  const dotActive = whisperVisible || !!anchorOverride;

  const whisperColors = whisper ? ACCENTS[whisper.accent] : anchorColors;

  return (
    <div className="flex items-start gap-2 mb-3 px-4">
      {/* Dot — anchored at the start of the anchor line. Halo always
          breathing softly. Dot itself scales 1 → 1.18 on activity. */}
      <div className="relative flex items-center justify-center flex-shrink-0" style={{ width: 10, height: 10, marginTop: 6 }}>
        <div
          className="absolute inset-0 rounded-full voyo-anchored-halo"
          style={{
            background: `radial-gradient(circle, ${anchorColors.halo} 0%, transparent 70%)`,
            transition: `background ${FADE_MS}ms ease`,
          }}
        />
        <div
          className="relative w-1.5 h-1.5 rounded-full"
          style={{
            background: anchorColors.bg,
            boxShadow: `0 0 6px ${anchorColors.shadow}`,
            transform: `scale(${dotActive ? 1.18 : 1})`,
            transition: `transform ${FADE_MS}ms cubic-bezier(0.16, 1, 0.3, 1), background ${FADE_MS}ms ease, box-shadow ${FADE_MS}ms ease`,
          }}
        />
      </div>

      {/* Stacked text column — anchor on top, whisper below. minWidth:0
          lets the text truncate cleanly when the line gets long. */}
      <div className="flex flex-col" style={{ minWidth: 0, flex: '1 1 auto' }}>
        {/* Anchor — "Oyé We Live" most of the time; major tales swap
            in via key-change crossfade at the same size + position. */}
        <span
          key={`anchor-${anchorText}`}
          className="text-white/90 font-bold text-sm whitespace-nowrap overflow-hidden text-ellipsis"
          style={{
            animation: `voyo-anchored-anchor-in ${FADE_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            letterSpacing: '0.005em',
          }}
        >
          {anchorText}
        </span>

        {/* Whisper layer — 60% font size of the anchor (~8.4px from
            14px anchor). Rises from the dot via scaleX (origin-left)
            + opacity + tiny upward translate. Reserved height of 0
            when collapsed so the layout doesn't jump. */}
        <span
          aria-hidden={!whisperVisible}
          style={{
            fontSize: '0.6em',                  // 60% of parent
            lineHeight: 1.4,
            color: whisperColors.text,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            transformOrigin: 'left center',
            transform: whisperVisible ? 'scaleX(1) translateY(0)' : 'scaleX(0) translateY(-2px)',
            opacity: whisperVisible ? 1 : 0,
            transition: `transform ${FADE_MS}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${FADE_MS}ms ease, color ${FADE_MS}ms ease`,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'inline-block',
            marginTop: 1,
            // Reserve no height when collapsed so layout is stable
            // either way — the row keeps the anchor's own height as
            // its stable anchor.
            maxHeight: whisperVisible ? '14px' : '0px',
          }}
        >
          {whisper?.text ?? ' '}
        </span>
      </div>

      <style>{`
        @keyframes voyo-anchored-halo-breath {
          0%, 100% { opacity: 0.35; transform: scale(1); }
          50%      { opacity: 0.8;  transform: scale(1.35); }
        }
        @keyframes voyo-anchored-anchor-in {
          from { opacity: 0; transform: translateY(-2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .voyo-anchored-halo {
          animation: voyo-anchored-halo-breath 2400ms ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .voyo-anchored-halo { animation: none; opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

export default AnchoredTaleHeader;
