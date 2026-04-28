/**
 * ClassicsContractedShelf — the new All-Time Classics surface (V1.1).
 *
 * Replaces the multi-disc carousel with a single luxury disc on the right of
 * a compact header. Horizontal swipe cycles through the available cards;
 * after the last card, a subtle "come back tomorrow" sign-off appears in the
 * disc spot. Swipe right to revisit any earlier card. Bidirectional, gestural,
 * single-signature-element design (memory: voyo-premium-less-is-more).
 *
 * State machine is just an integer `index` ∈ [0, tracks.length]:
 *   · 0..tracks.length-1  → showing tracks[index]
 *   · tracks.length        → "come back tomorrow"
 *
 * No phase machine, no auto-cycle. User scrolls. That's it.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '../../types';
import { getThumb } from '../../utils/thumbnail';
import { SmartImage } from '../ui/SmartImage';

// ─── TUNABLES (Dash will iterate) ──────────────────────────────────────────
const DISC_SIZE = 116;
const SHELF_HEIGHT = 156;
const SWIPE_THRESHOLD_PX = 32;
const SWIPE_MAX_DURATION_MS = 1000;
const CROSSFADE_MS = 360;
const BRONZE = '#D4A053';

interface Props {
  tracks: Track[];
  onPlay: (track: Track) => void;
}

function ClassicsContractedShelfImpl({ tracks, onPlay }: Props) {
  const [index, setIndex] = useState(0);

  // Keep index inside valid range as tracks list updates (e.g. drop ends).
  useEffect(() => {
    const maxIndex = tracks.length;
    if (index > maxIndex) setIndex(0);
  }, [tracks.length, index]);

  const isEndState = index >= tracks.length;
  const currentTrack = isEndState ? null : tracks[index] ?? null;

  // ── Swipe detection (touch + mouse drag) ───────────────────────────────
  const dragRef = useRef<{ startX: number; startTime: number; active: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startTime: Date.now(), active: true };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const elapsed = Date.now() - drag.startTime;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || elapsed > SWIPE_MAX_DURATION_MS) return;
    if (dx < 0) {
      setIndex(i => Math.min(i + 1, tracks.length));
    } else {
      setIndex(i => Math.max(i - 1, 0));
    }
  };

  // Wheel (trackpad horizontal scroll on desktop) — fires once per gesture.
  const wheelLockRef = useRef<number>(0);
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
    if (Math.abs(e.deltaX) < 24) return;
    const now = Date.now();
    if (now - wheelLockRef.current < 350) return;
    wheelLockRef.current = now;
    if (e.deltaX > 0) setIndex(i => Math.min(i + 1, tracks.length));
    else setIndex(i => Math.max(i - 1, 0));
  };

  const handleDiscClick = () => {
    if (currentTrack) onPlay(currentTrack);
  };

  // ── Position indicator: dots showing index out of (tracks.length + 1). ─
  const totalSlots = tracks.length + (tracks.length > 0 ? 1 : 0); // +1 for end-slot when there are tracks
  const dots = useMemo(
    () => (totalSlots > 1 ? Array.from({ length: totalSlots }, (_, i) => i) : []),
    [totalSlots],
  );

  return (
    <div
      className="relative mb-10 select-none"
      style={{
        height: SHELF_HEIGHT,
        // Subtle gold-radial wash anchoring the surface — restraint, not boldness.
        background:
          'radial-gradient(ellipse 90% 80% at 22% 50%, rgba(212,160,83,0.10) 0%, rgba(212,160,83,0.04) 45%, transparent 78%)',
        contain: 'paint',
        touchAction: 'pan-y',
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { dragRef.current = null; }}
      onWheel={onWheel}
    >
      {/* Hairline gold borders anchoring the row. */}
      <div
        className="absolute top-0 left-8 right-8 md:left-12 md:right-12 h-px pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(212,160,83,0.32), rgba(230,184,101,0.65), rgba(212,160,83,0.32), transparent)',
        }}
      />
      <div
        className="absolute bottom-0 left-8 right-8 md:left-12 md:right-12 h-px pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(212,160,83,0.18), rgba(230,184,101,0.42), rgba(212,160,83,0.18), transparent)',
        }}
      />

      {/* ── Header (left, compact) ──────────────────────────────────────── */}
      <div
        className="absolute left-5 top-1/2 flex items-center gap-3"
        style={{ transform: 'translateY(-50%)' }}
      >
        {/* Bronze disc icon — same vocabulary as the original shelf. */}
        <div
          className="flex-shrink-0 relative rounded-full"
          style={{
            width: 36,
            height: 36,
            background: 'radial-gradient(circle at 50% 50%, #2a1a08 0%, #0d0804 100%)',
            boxShadow: '0 0 0 1.5px rgba(212,160,83,0.55), 0 4px 14px rgba(0,0,0,0.65)',
          }}
        >
          <div
            className="absolute rounded-full"
            style={{
              width: 11,
              height: 11,
              top: '50%',
              left: '50%',
              transform: 'translate(-50%,-50%)',
              background: 'radial-gradient(circle, #D4A053 0%, #8B5E1A 100%)',
            }}
          />
          <div className="absolute inset-0 rounded-full" style={{ border: '1px solid rgba(212,160,83,0.18)', margin: 5 }} />
          <div className="absolute inset-0 rounded-full" style={{ border: '1px solid rgba(212,160,83,0.08)', margin: 9 }} />
        </div>
        <div className="min-w-0">
          <h2
            className="leading-none"
            style={{
              fontFamily: "'Fraunces', 'Playfair Display', Georgia, serif",
              fontStyle: 'italic',
              fontSize: 16,
              fontWeight: 500,
              background: 'linear-gradient(100deg, #F4D999 0%, #E6B865 50%, #C4943D 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              opacity: 0.95,
            }}
          >
            All-Time Classics
          </h2>
          <p
            className="text-[9px] tracking-widest uppercase mt-1"
            style={{
              fontFamily: 'Satoshi, system-ui, sans-serif',
              fontWeight: 700,
              color: 'rgba(212,160,83,0.55)',
            }}
          >
            African Bangers · <b style={{ fontWeight: 800, color: 'rgba(230,184,101,0.78)' }}>VOYO Certified</b>
          </p>
        </div>
      </div>

      {/* ── Right zone: single disc OR end-state ─────────────────────────── */}
      <div
        className="absolute top-1/2 flex items-center justify-center"
        style={{
          right: 24,
          transform: 'translateY(-50%)',
          width: DISC_SIZE + 28,
          height: DISC_SIZE + 28,
        }}
      >
        {/* Subtle ambient glow — luxury anchor, not a beam. */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 50% 50%, rgba(212,160,83,0.18) 0%, rgba(212,160,83,0.06) 45%, transparent 75%)',
            filter: 'blur(4px)',
          }}
          aria-hidden
        />

        {/* Crossfade layer — keyed on (index, isEndState) so each transition
            remounts the active child cleanly under one CSS animation. */}
        <div
          key={`${index}-${isEndState ? 'end' : 'disc'}-${currentTrack?.id ?? ''}`}
          className="relative flex items-center justify-center w-full h-full classics-cf-in"
          style={{ animation: `classics-shelf-fade-in ${CROSSFADE_MS}ms cubic-bezier(0.16, 1, 0.3, 1) both` }}
        >
          {currentTrack ? (
            <button
              type="button"
              onClick={handleDiscClick}
              aria-label={`Play ${currentTrack.title}`}
              className="relative rounded-full p-0 border-0 cursor-pointer"
              style={{
                width: DISC_SIZE,
                height: DISC_SIZE,
                background: 'radial-gradient(circle at 50% 50%, #1a1208 0%, #0a0604 100%)',
                boxShadow:
                  '0 0 0 1px rgba(212,160,83,0.45), 0 6px 22px rgba(0,0,0,0.55), 0 0 32px rgba(212,160,83,0.18)',
              }}
            >
              {/* Album art clipped to inner circle. */}
              <div
                className="absolute rounded-full overflow-hidden"
                style={{
                  inset: 8,
                  background: '#0a0604',
                }}
              >
                <SmartImage
                  src={currentTrack.coverUrl || getThumb(currentTrack.trackId || currentTrack.id)}
                  alt={`${currentTrack.title} — ${currentTrack.artist}`}
                  className="w-full h-full object-cover"
                />
                {/* Inner label dot — center punch, matches header icon. */}
                <div
                  className="absolute rounded-full"
                  style={{
                    width: 14,
                    height: 14,
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%,-50%)',
                    background: 'radial-gradient(circle, #D4A053 0%, #8B5E1A 100%)',
                    boxShadow: '0 0 0 2px #0a0604, 0 0 12px rgba(212,160,83,0.5)',
                  }}
                />
              </div>
              {/* Bronze hairline ring sitting just outside the art for depth. */}
              <div
                className="absolute rounded-full pointer-events-none"
                style={{
                  inset: 2,
                  border: '1px solid rgba(212,160,83,0.22)',
                }}
              />
            </button>
          ) : (
            <div
              className="text-center px-4 select-none pointer-events-none"
              style={{
                width: DISC_SIZE + 12,
              }}
            >
              <p
                className="leading-tight"
                style={{
                  fontFamily: "'Fraunces', 'Playfair Display', Georgia, serif",
                  fontStyle: 'italic',
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'rgba(212,160,83,0.72)',
                  letterSpacing: '-0.005em',
                }}
              >
                Come back
              </p>
              <p
                className="leading-tight mt-1"
                style={{
                  fontFamily: "'Fraunces', 'Playfair Display', Georgia, serif",
                  fontStyle: 'italic',
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'rgba(212,160,83,0.55)',
                  letterSpacing: '-0.005em',
                }}
              >
                tomorrow
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Position indicator — tiny dots at bottom center. Only shows when more than 1 slot. */}
      {dots.length > 0 && (
        <div
          className="absolute bottom-2 left-1/2 flex gap-1.5"
          style={{ transform: 'translateX(-50%)' }}
          aria-hidden
        >
          {dots.map(i => (
            <span
              key={i}
              style={{
                width: i === index ? 14 : 4,
                height: 4,
                borderRadius: 2,
                background: i === index ? BRONZE : 'rgba(212,160,83,0.25)',
                transition: 'all 280ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          ))}
        </div>
      )}

      <style>{`
        @keyframes classics-shelf-fade-in {
          from { opacity: 0; transform: scale(0.94); }
          to   { opacity: 1; transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .classics-cf-in { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>
    </div>
  );
}

export const ClassicsContractedShelf = memo(ClassicsContractedShelfImpl);
ClassicsContractedShelf.displayName = 'ClassicsContractedShelf';
