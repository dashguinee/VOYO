/**
 * ClassicsDropCeremony — single-disc ceremony surface for live "Classics Drop".
 *
 * Replaces the All-Time Classics carousel for the duration of an active drop
 * (see services/classicsDropService.ts). Strict ONE disc on stage at a time —
 * the disc drifts in from the right while spinning, lands, and a purple→gold
 * glow masks the spin deceleration. Header retracts toward the bronze icon
 * and the song title fades in where the header used to live.
 *
 * Design rule (memory: voyo-premium-less-is-more): ONE signature element per
 * surface. The signature here is the disc-drift. Everything else is restraint.
 *
 * Iteration philosophy: every timing/glow/distance constant lives at the top
 * of this file. Dash will iterate. Don't bake magic numbers into the JSX.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import type { Track } from '../../types';
import type { ClassicsDrop } from '../../services/classicsDropService';
import { getThumb } from '../../utils/thumbnail';
import { SmartImage } from '../ui/SmartImage';
import { usePlayerStore } from '../../store/playerStore';

// ─── TIMINGS / GEOMETRY (Dash will tune these) ───────────────────────────────

/** Disc enters from translateX(110%) → 0 over this duration. */
const DRIFT_IN_DURATION_MS = 1000;
/** Disc spins this many degrees during the drift. */
const DRIFT_SPIN_DEGREES = 720;
/** Easing for both drift-in and drift-out. */
const DRIFT_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';
/** Glow burst starts this many ms before drift completes. Masks deceleration. */
const GLOW_LEAD_MS = 0;
/** Glow burst peaks this far past drift end. */
const GLOW_PEAK_OFFSET_MS = 200;
/** Glow burst fades to zero this far past drift end. */
const GLOW_FADE_OFFSET_MS = 800;
/** Drift-out duration when disc cycles or ceremony dissolves. */
const DRIFT_OUT_DURATION_MS = 600;
/** Pause between disc-out and disc-in when cycling tracks. */
const CYCLE_GAP_MS = 220;
/** Header retract: scale + opacity transition duration. */
const HEADER_RETRACT_MS = 600;
/** End-of-drop dissolve duration. */
const DISSOLVE_MS = 600;

/** Disc visual size in px. */
const DISC_SIZE = 200;
/** Right inset of the disc on stage (from container right edge). */
const DISC_RIGHT_PX = 24;

// ─── COLOURS ─────────────────────────────────────────────────────────────────

const BRONZE = '#D4A053';
const BRONZE_DEEP = '#8B5E1A';
const PURPLE_GLOW = 'rgba(140, 92, 200, 0.55)';
const GOLD_GLOW = 'rgba(255, 220, 140, 0.85)';
const PURPLE_RING = 'rgba(140, 92, 200, 0.40)';

// ─── COMPONENT ───────────────────────────────────────────────────────────────

interface ClassicsDropCeremonyProps {
  drop: ClassicsDrop;
  tracks: Track[];
  onPlay: (track: Track) => void;
}

type Phase = 'incoming' | 'on-stage' | 'cycling-out' | 'dissolving';

function ClassicsDropCeremonyImpl({ drop: _drop, tracks, onPlay }: ClassicsDropCeremonyProps) {
  void _drop; // reserved for future use (e.g. drop notes) — kept to align
              // with spec'd component contract and avoid breaking parent diff.

  // Index of the disc currently on stage (or about to be).
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('incoming');

  // Watch the player's current track. If the on-stage disc was the playing
  // track and currentTrack changes to anything else (track ended, user skipped,
  // user picked something else from another shelf), cycle to the next disc.
  const playerCurrentTrack = usePlayerStore(useShallow(s => s.currentTrack));
  const lastPlayedRef = useRef<string | null>(null);

  const onStageTrack = tracks[index] ?? null;

  // Auto-advance when the on-stage track has finished playing.
  useEffect(() => {
    if (!onStageTrack) return;
    const playerId = playerCurrentTrack?.id ?? null;
    // Track started playing on stage → remember it.
    if (playerId === onStageTrack.id) {
      lastPlayedRef.current = onStageTrack.id;
      return;
    }
    // The disc-on-stage was playing, and now playback moved off it → cycle.
    if (lastPlayedRef.current === onStageTrack.id && playerId !== onStageTrack.id) {
      lastPlayedRef.current = null;
      cycleToNext();
    }
    // Run on player state change. cycleToNext is stable (closure on tracks.length).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerCurrentTrack?.id, onStageTrack?.id]);

  // Drift-in sequence — phase: incoming → on-stage after drift completes.
  useEffect(() => {
    if (phase !== 'incoming') return;
    const t = setTimeout(() => setPhase('on-stage'), DRIFT_IN_DURATION_MS + GLOW_FADE_OFFSET_MS);
    return () => clearTimeout(t);
  }, [phase, index]);

  function cycleToNext() {
    if (tracks.length === 0) return;
    setPhase('cycling-out');
    window.setTimeout(() => {
      setIndex(prev => (prev + 1) % tracks.length);
      setPhase('incoming');
    }, DRIFT_OUT_DURATION_MS + CYCLE_GAP_MS);
  }

  function handleDiscTap() {
    if (!onStageTrack) return;
    if (phase !== 'on-stage') return;
    onPlay(onStageTrack);
  }

  // Header retract — only retract while a disc is "on the stage" (incoming /
  // on-stage / cycling-out). When dissolving back to the shelf, header
  // un-retracts so the existing shelf's All-Time Classics title returns
  // before this component unmounts.
  const headerRetracted = phase === 'incoming' || phase === 'on-stage' || phase === 'cycling-out';

  // ─── Disc transform / opacity per phase ───────────────────────────────────

  let discTransform = 'translateX(110%) rotate(0deg)';
  let discOpacity = 0;
  let glowOpacity = 0;

  if (phase === 'incoming') {
    // Animation handled by CSS keyframes (see <style> below). Final state
    // matches "on-stage" — keyframe handles the transition + spin.
    discTransform = 'translateX(0) rotate(0deg)';
    discOpacity = 1;
    glowOpacity = 0; // glow is keyframed below
  } else if (phase === 'on-stage') {
    discTransform = 'translateX(0) rotate(0deg)';
    discOpacity = 1;
    glowOpacity = 0;
  } else if (phase === 'cycling-out' || phase === 'dissolving') {
    discTransform = 'translateX(-130%) rotate(-180deg)';
    discOpacity = 0;
    glowOpacity = 0;
  }

  // Memoised so the inline style identity doesn't change on every render.
  const discStyle = useMemo<React.CSSProperties>(() => ({
    width: DISC_SIZE,
    height: DISC_SIZE,
    right: DISC_RIGHT_PX,
    top: '50%',
    transform: `translateY(-50%) ${discTransform}`,
    opacity: discOpacity,
    transition: phase === 'cycling-out' || phase === 'dissolving'
      ? `transform ${DRIFT_OUT_DURATION_MS}ms ${DRIFT_EASING}, opacity ${DRIFT_OUT_DURATION_MS}ms ease`
      : 'none',
  }), [discTransform, discOpacity, phase]);

  // Track resolution — fall back to "no ceremony" outside (HomeFeed wrapper),
  // but if somehow we ended up here without tracks, render nothing.
  if (tracks.length === 0 || !onStageTrack) return null;

  return (
    <div
      className="mb-10 pt-12 pb-12 relative overflow-hidden"
      style={{
        background: 'radial-gradient(ellipse 120% 80% at 30% 0%, rgba(212,160,83,0.18) 0%, rgba(212,160,83,0.07) 45%, transparent 75%)',
        contain: 'paint',
      }}
    >
      <style>{`
        @keyframes classics-drop-disc-in {
          0%   { transform: translateY(-50%) translateX(110%) rotate(0deg); opacity: 0; }
          15%  { opacity: 1; }
          100% { transform: translateY(-50%) translateX(0) rotate(${DRIFT_SPIN_DEGREES}deg); opacity: 1; }
        }
        @keyframes classics-drop-glow-burst {
          0%   { opacity: 0; transform: scale(0.85); }
          ${Math.round((GLOW_LEAD_MS / (DRIFT_IN_DURATION_MS + GLOW_FADE_OFFSET_MS)) * 100)}% { opacity: 0; }
          ${Math.round(((DRIFT_IN_DURATION_MS + GLOW_PEAK_OFFSET_MS) / (DRIFT_IN_DURATION_MS + GLOW_FADE_OFFSET_MS)) * 100)}% { opacity: 1; transform: scale(1.05); }
          100% { opacity: 0; transform: scale(1.0); }
        }
        @keyframes classics-drop-title-in {
          from { opacity: 0; transform: translateX(-12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .classics-drop-disc-in {
          animation: classics-drop-disc-in ${DRIFT_IN_DURATION_MS}ms ${DRIFT_EASING} both;
        }
        .classics-drop-glow {
          animation: classics-drop-glow-burst ${DRIFT_IN_DURATION_MS + GLOW_FADE_OFFSET_MS}ms ease-out both;
        }
        .classics-drop-title-in {
          animation: classics-drop-title-in 540ms ${DRIFT_EASING} both;
        }
        @media (prefers-reduced-motion: reduce) {
          .classics-drop-disc-in,
          .classics-drop-glow,
          .classics-drop-title-in {
            animation: none;
            opacity: 1;
            transform: none;
          }
        }
      `}</style>

      {/* Gold hairlines — shared with the existing shelf for visual continuity. */}
      <div
        className="absolute top-0 left-8 right-8 md:left-12 md:right-12 h-px pointer-events-none"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(212,160,83,0.4), rgba(230,184,101,0.75), rgba(212,160,83,0.4), transparent)' }}
      />
      <div
        className="absolute bottom-0 left-8 right-8 md:left-12 md:right-12 h-px pointer-events-none"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(212,160,83,0.25), rgba(230,184,101,0.5), rgba(212,160,83,0.25), transparent)' }}
      />

      {/* Header row: bronze icon + retracting title + drifting song title */}
      <div className="px-5 mb-6 flex items-center gap-3 relative" style={{ minHeight: 56 }}>
        {/* 36×36 bronze state-indicator — matches existing shelf icon. */}
        <div
          className="flex-shrink-0 relative rounded-full"
          style={{
            width: 36,
            height: 36,
            background: 'radial-gradient(circle at 50% 50%, #2a1a08 0%, #0d0804 100%)',
            boxShadow: `0 0 0 1.5px rgba(212,160,83,0.55), 0 4px 14px rgba(0,0,0,0.65), 0 0 18px rgba(212,160,83,${phase === 'on-stage' ? 0.35 : 0.15})`,
            transition: 'box-shadow 600ms ease',
          }}
          aria-label="Classics Drop live"
        >
          <div
            className="absolute rounded-full"
            style={{
              width: 11,
              height: 11,
              top: '50%',
              left: '50%',
              transform: 'translate(-50%,-50%)',
              background: `radial-gradient(circle, ${BRONZE} 0%, ${BRONZE_DEEP} 100%)`,
            }}
          />
          <div className="absolute inset-0 rounded-full" style={{ border: '1px solid rgba(212,160,83,0.18)', margin: 5 }} />
          <div className="absolute inset-0 rounded-full" style={{ border: '1px solid rgba(212,160,83,0.08)', margin: 9 }} />
        </div>

        {/* Title stack — retracts toward the icon when a disc is on stage. */}
        <div
          style={{
            transform: headerRetracted ? 'scale(0.5)' : 'scale(1)',
            transformOrigin: 'left center',
            opacity: headerRetracted ? 0.45 : 0.93,
            transition: `transform ${HEADER_RETRACT_MS}ms ${DRIFT_EASING}, opacity ${HEADER_RETRACT_MS}ms ease`,
            // Tighten the layout when retracted so the song title can move
            // into the space without overlapping. width transition is fine
            // because the parent is flex; we keep the visual but pull the
            // column tight.
            maxWidth: headerRetracted ? '50%' : '100%',
          }}
        >
          <h2
            className="leading-none"
            style={{
              fontFamily: "'Fraunces', 'Playfair Display', Georgia, serif",
              fontStyle: 'italic',
              fontSize: 24,
              fontWeight: 400,
              background: 'linear-gradient(100deg, #F4D999 0%, #E6B865 40%, #C4943D 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: [
                'drop-shadow(0 1px 4px rgba(0,0,0,0.6))',
                'drop-shadow(0 0 14px rgba(212,160,83,0.2))',
                'drop-shadow(0 0 24px rgba(255,248,232,0.18))',
              ].join(' '),
            }}
          >
            All-Time Classics
          </h2>
          <p
            className="text-[10px] tracking-widest uppercase mt-1"
            style={{
              fontFamily: 'Satoshi, system-ui, sans-serif',
              fontWeight: 700,
              color: 'rgba(212,160,83,0.78)',
            }}
          >
            African Bangers · <b style={{ fontWeight: 800 }}>VOYO Certified</b>
          </p>
        </div>

        {/* Song title slot — drifts in from left in sync with disc drift in.
            Uses absolute positioning so the retracted header doesn't push it. */}
        {onStageTrack && headerRetracted && (
          <div
            key={`title-${onStageTrack.id}-${index}`}
            className="classics-drop-title-in"
            style={{
              position: 'absolute',
              left: 'calc(36px + 0.75rem + 50% - 12px)', // icon width + gap + a touch right of the retracted header column
              top: 0,
              bottom: 0,
              right: `${DISC_SIZE + DISC_RIGHT_PX + 24}px`,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <p
              className="leading-tight"
              style={{
                fontFamily: "'Fraunces', 'Playfair Display', Georgia, serif",
                fontStyle: 'italic',
                fontSize: 20,
                fontWeight: 400,
                color: 'rgba(255,250,235,0.92)',
                margin: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {onStageTrack.title}
            </p>
            <p
              className="leading-tight"
              style={{
                fontFamily: 'Satoshi, system-ui, sans-serif',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'rgba(212,160,83,0.42)',
                marginTop: 4,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {onStageTrack.artist}
            </p>
          </div>
        )}
      </div>

      {/* Stage — single disc, right zone. */}
      <div className="relative" style={{ height: DISC_SIZE + 24 }}>
        <button
          type="button"
          onClick={handleDiscTap}
          aria-label={`Play ${onStageTrack.title} by ${onStageTrack.artist}`}
          className={phase === 'incoming' ? 'classics-drop-disc-in' : ''}
          style={{
            ...discStyle,
            position: 'absolute',
            border: 'none',
            padding: 0,
            background: 'transparent',
            cursor: 'pointer',
            // Shadow lives on the disc body itself, not the button.
          }}
        >
          {/* Outer disc — bronze metal ring + middle ring + label. */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              background: `radial-gradient(circle at 50% 50%, #1d130a 0%, #0a0604 100%)`,
              boxShadow: `0 0 0 1px rgba(212,160,83,0.6), 0 0 0 4px rgba(212,160,83,0.12), 0 12px 38px rgba(0,0,0,0.7)`,
            }}
          >
            {/* Outer hairline — subtle bronze. */}
            <div
              style={{
                position: 'absolute',
                inset: 6,
                borderRadius: '50%',
                border: '1px solid rgba(212,160,83,0.22)',
              }}
            />
            {/* Middle ring — slightly darker, pure depth cue. */}
            <div
              style={{
                position: 'absolute',
                inset: 18,
                borderRadius: '50%',
                border: '1px solid rgba(212,160,83,0.12)',
              }}
            />
            {/* Album-art label — clipped to a circle in the centre. */}
            <div
              style={{
                position: 'absolute',
                inset: '22%',
                borderRadius: '50%',
                overflow: 'hidden',
                boxShadow: `inset 0 0 0 1px ${PURPLE_RING}`,
              }}
            >
              <SmartImage
                src={getThumb(onStageTrack.trackId, 'high')}
                alt={onStageTrack.title}
                className="w-full h-full object-cover"
                trackId={onStageTrack.trackId}
                artist={onStageTrack.artist}
                title={onStageTrack.title}
              />
            </div>
            {/* Centre dot — bronze pinprick over the label. */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: BRONZE,
                transform: 'translate(-50%, -50%)',
                boxShadow: `0 0 0 2px rgba(0,0,0,0.6), 0 0 6px ${BRONZE}`,
              }}
            />

            {/* Glow burst — purple → gold radial that masks spin deceleration. */}
            {phase === 'incoming' && (
              <div
                key={`glow-${onStageTrack.id}-${index}`}
                className="classics-drop-glow"
                style={{
                  position: 'absolute',
                  inset: -18,
                  borderRadius: '50%',
                  background: `radial-gradient(circle, ${GOLD_GLOW} 0%, ${PURPLE_GLOW} 45%, transparent 72%)`,
                  pointerEvents: 'none',
                  mixBlendMode: 'screen',
                  opacity: glowOpacity, // safety — keyframe handles the curve
                }}
              />
            )}
          </div>
        </button>
      </div>

      {/* Subtle position indicator — 7 tiny dots under the stage. ONE element,
          minimal ornament. Lets the user feel the cycle progress. */}
      {tracks.length > 1 && (
        <div className="px-5 mt-4 flex justify-center gap-1.5" aria-hidden>
          {tracks.map((t, i) => (
            <span
              key={t.id}
              style={{
                display: 'inline-block',
                width: i === index ? 14 : 4,
                height: 4,
                borderRadius: 2,
                background: i === index ? BRONZE : 'rgba(212,160,83,0.22)',
                transition: 'width 320ms ease, background 320ms ease',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const ClassicsDropCeremony = memo(ClassicsDropCeremonyImpl);
export default ClassicsDropCeremony;
