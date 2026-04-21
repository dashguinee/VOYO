/**
 * VibesReel — a single horizontal-scroll row of vibe "chapters". Each
 * chapter is an AI vibe-cover card followed by N real track covers
 * pulled from the R2-cached pool for that vibe.
 *
 *   [AI: HEATING UP RN]  [track]  [track]  [track]  [track]  [track]
 *   [AI: CHILL]          [track]  [track]  [track]  [track]  [track]
 *   [AI: PARTY]          [track]  [track]  [track]  [track]  [track]
 *   ... (all inline in one scroll)
 *
 * Tap AI card → play vibe (playFromVibe) — current "open this vibe"
 * behavior preserved.
 * Tap track card → play that exact track.
 *
 * Keeps it lightweight: each track card renders a single <img> with
 * loading="lazy" + decoding="async". 5 tracks × 5 vibes = 25 thumbs
 * max on screen as the row scrolls into view.
 */

import { memo } from 'react';
import type { Vibe } from '../../data/tracks';
import type { Track } from '../../types';
import type { VibeMode } from '../../store/intentStore';
import { useVibePoolBatch } from '../../hooks/useVibePoolPick';
import { getThumb } from '../../utils/thumbnail';
import { app } from '../../services/oyo';

interface VibesReelProps {
  vibes: Vibe[];
  onOpenVibe: (vibe: Vibe) => void;
}

// ── AI vibe-cover (chapter marker) ──────────────────────────────────────
const VibeCoverCard = memo(({ vibe, onTap }: { vibe: Vibe; onTap: () => void }) => (
  <button
    onClick={onTap}
    className="relative flex-shrink-0 rounded-[18px] overflow-hidden active:scale-[0.97] transition-transform"
    style={{
      width: 130,
      aspectRatio: '0.82',
      background: `linear-gradient(135deg, ${vibe.color} 0%, ${vibe.color}dd 50%, ${vibe.color}bb 100%)`,
      boxShadow: `0 6px 22px ${vibe.color}4d`,
    }}
  >
    {vibe.image && (
      <img
        src={vibe.image}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: 'scale(1.04)', transformOrigin: 'center 30%' }}
      />
    )}
    {/* Palette wash — unifies the cover with the vibe color. */}
    <div
      className="absolute inset-0"
      style={{
        background: `linear-gradient(135deg, ${vibe.color}3a 0%, ${vibe.color}66 55%, ${vibe.color}aa 100%)`,
        mixBlendMode: 'overlay',
      }}
    />
    {/* Bottom darken for title readability. */}
    <div
      className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none"
      style={{ background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.18) 42%, rgba(0,0,0,0.62) 100%)' }}
    />
    {/* Vibe title */}
    <div className="absolute inset-x-0 bottom-0 p-3">
      <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/70 mb-0.5">Vibe</p>
      <h3 className="text-white font-black leading-none tracking-tight" style={{ fontSize: vibe.name.length > 10 ? 14 : 16 }}>
        {vibe.name}
      </h3>
    </div>
  </button>
));
VibeCoverCard.displayName = 'VibeCoverCard';

// ── Live track card (pool) ──────────────────────────────────────────────
const ReelTrackCard = memo(({ track, accent }: { track: Track; accent: string }) => (
  <button
    onClick={() => app.playTrack(track, 'vibe')}
    className="relative flex-shrink-0 rounded-[16px] overflow-hidden active:scale-[0.95] transition-transform"
    style={{
      width: 104,
      aspectRatio: '0.82',
      boxShadow: `0 4px 16px rgba(0,0,0,0.38), 0 0 0 1px ${accent}22`,
    }}
  >
    <img
      src={getThumb(track.trackId, 'high')}
      alt={track.title}
      loading="lazy"
      decoding="async"
      className="absolute inset-0 w-full h-full object-cover"
    />
    {/* Soft vibe-color rim — keeps the reel feeling like one canvas. */}
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        background: `radial-gradient(140% 90% at 50% 100%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.22) 38%, transparent 72%)`,
      }}
    />
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.06)` }}
    />
    {/* Title + artist */}
    <div className="absolute inset-x-0 bottom-0 px-2 pb-2">
      <p className="text-white text-[10.5px] font-semibold leading-tight truncate">{track.title}</p>
      <p className="text-white/60 text-[9.5px] leading-tight truncate">{track.artist}</p>
    </div>
  </button>
));
ReelTrackCard.displayName = 'ReelTrackCard';

// ── Chapter: AI cover + batch of pool tracks for this vibe ─────────────
const Chapter = memo(({ vibe, onOpenVibe }: { vibe: Vibe; onOpenVibe: (v: Vibe) => void }) => {
  const tracks = useVibePoolBatch(vibe.id as VibeMode, 5);
  return (
    <>
      <VibeCoverCard vibe={vibe} onTap={() => onOpenVibe(vibe)} />
      {tracks.map((t) => (
        <ReelTrackCard key={`${vibe.id}-${t.id || t.trackId}`} track={t} accent={vibe.color} />
      ))}
    </>
  );
});
Chapter.displayName = 'Chapter';

export const VibesReel = ({ vibes, onOpenVibe }: VibesReelProps) => {
  return (
    <div
      className="flex gap-2.5 px-4 overflow-x-auto scrollbar-hide py-4"
      style={{ scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch' }}
    >
      {vibes.map((v) => (
        <Chapter key={v.id} vibe={v} onOpenVibe={onOpenVibe} />
      ))}
    </div>
  );
};

export default VibesReel;
