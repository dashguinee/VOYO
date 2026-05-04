/**
 * VoyoEarth — Cultural Compass Explorer
 *
 * Swipe to travel the continent through captured moments. No categories,
 * no labels. The compass is discovered through gesture:
 *
 *   UP    = THE FLOOR — what's heating right now (heat_score)
 *   DOWN  = THE VAULT — undiscovered fresh content (low plays)
 *   LEFT  = WEST — Nigeria, Ghana, Senegal, Atlantic diaspora
 *   RIGHT = EAST — Kenya, Angola, SA, Lusophone + North Africa
 *
 * Music keeps playing behind every moment. Cultural origin floats below.
 */

import React, {
  useState, useRef, useEffect, useCallback, memo,
} from 'react';
import { X, Heart, Play } from 'lucide-react';
import { useEarth, EarthDir } from '../../../hooks/useEarth';
import type { Moment } from '../../../types/moments';
import { usePlayerStore } from '../../../store/playerStore';

const VOYO_API = import.meta.env.VITE_API_URL || 'https://voyo-edge.dash-webtv.workers.dev';

// ── Cultural origin map ───────────────────────────────────────────────────

const ORIGIN_MAP: Record<string, { flag: string; label: string }> = {
  nigeria: { flag: '🇳🇬', label: 'Lagos' },
  naija: { flag: '🇳🇬', label: 'Lagos' },
  ghana: { flag: '🇬🇭', label: 'Accra' },
  senegal: { flag: '🇸🇳', label: 'Dakar' },
  guinea: { flag: '🇬🇳', label: 'Conakry' },
  cameroon: { flag: '🇨🇲', label: 'Douala' },
  mali: { flag: '🇲🇱', label: 'Bamako' },
  kenya: { flag: '🇰🇪', label: 'Nairobi' },
  tanzania: { flag: '🇹🇿', label: 'Dar es Salaam' },
  ethiopia: { flag: '🇪🇹', label: 'Addis Ababa' },
  uganda: { flag: '🇺🇬', label: 'Kampala' },
  angola: { flag: '🇦🇴', label: 'Luanda' },
  mozambique: { flag: '🇲🇿', label: 'Maputo' },
  'south-africa': { flag: '🇿🇦', label: 'Johannesburg' },
  'southern-africa': { flag: '🇿🇦', label: 'Southern Africa' },
  mzansi: { flag: '🇿🇦', label: 'Mzansi' },
  algeria: { flag: '🇩🇿', label: 'Algiers' },
  'north-africa': { flag: '🌍', label: 'North Africa' },
  'west-africa': { flag: '🌍', label: 'West Africa' },
  'east-africa': { flag: '🌍', label: 'East Africa' },
  'lusophone-africa': { flag: '🌍', label: 'Lusophone Africa' },
  diaspora: { flag: '🌐', label: 'Diaspora' },
  usa: { flag: '🇺🇸', label: 'United States' },
  uk: { flag: '🇬🇧', label: 'London' },
  france: { flag: '🇫🇷', label: 'Paris' },
  caribbean: { flag: '🌴', label: 'Caribbean' },
};

function getOrigin(tags: string[]): { flag: string; label: string } | null {
  for (const raw of tags) {
    const key = raw.toLowerCase().replace(/\s+/g, '-');
    if (ORIGIN_MAP[key]) return ORIGIN_MAP[key];
  }
  return null;
}

// ── Direction labels (brief compass hint) ────────────────────────────────

// Direction labels — culturally informed (Afropiano/Afrobeats up top,
// Singeli/Lekompo/underground in the vault, Atlantic West, Continental East)
const DIR_LABELS: Record<EarthDir, string> = {
  up:    'THE FLOOR',      // Afropiano, Afrobeats, party heat
  down:  'THE VAULT',      // Singeli, Lekompo, Way-Way, undiscovered
  left:  'NAIJA WAVE',     // Nigeria, Ghana, Senegal, Atlantic diaspora
  right: 'CONTINENTAL',   // East Africa, SA, Lusophone, North Africa
};

// ── CompassHint — shown once per session, fades after 4s ─────────────────

const COMPASS_SHOWN_KEY = 'voyo-earth-compass-v1';

const CompassHint = memo(({ onDone }: { onDone: () => void }) => {
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    const rAF = requestAnimationFrame(() => setOpacity(1));
    const fadeTimer = setTimeout(() => setOpacity(0), 3800);
    const doneTimer = setTimeout(onDone, 4400);
    return () => {
      cancelAnimationFrame(rAF);
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
      style={{ opacity, transition: 'opacity 600ms cubic-bezier(0.16, 1, 0.3, 1)' }}
    >
      <div
        className="flex flex-col items-center gap-1"
        style={{ color: 'rgba(255,255,255,0.85)' }}
      >
        {/* UP label */}
        <span className="text-[10px] font-bold tracking-[0.2em] uppercase">THE FLOOR ↑</span>
        <span className="text-[9px] tracking-wide" style={{ color: 'rgba(255,255,255,0.35)', marginTop: -2 }}>Afropiano · Afrobeats · heat</span>

        {/* Horizontal row */}
        <div className="flex items-center gap-6 mt-1">
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase">← NAIJA WAVE</span>
            <span className="text-[8px]" style={{ color: 'rgba(255,255,255,0.3)' }}>Lagos · Accra · diaspora</span>
          </div>

          {/* Center rose */}
          <div
            className="w-9 h-9 rounded-full border border-white/15 flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-white/50" />
          </div>

          <div className="flex flex-col items-start gap-0.5">
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase">CONTINENTAL →</span>
            <span className="text-[8px]" style={{ color: 'rgba(255,255,255,0.3)' }}>Nairobi · Joburg · Luanda</span>
          </div>
        </div>

        <span className="text-[10px] font-bold tracking-[0.2em] uppercase mt-1">↓ THE VAULT</span>
        <span className="text-[9px] tracking-wide" style={{ color: 'rgba(255,255,255,0.35)', marginTop: -2 }}>Singeli · Lekompo · underground</span>
      </div>
    </div>
  );
});
CompassHint.displayName = 'CompassHint';

// ── DirectionPulse — brief flash in swipe direction ──────────────────────

const DirectionPulse = memo(({ dir, active }: { dir: EarthDir | null; active: boolean }) => {
  if (!dir || !active) return null;

  const pos: Record<EarthDir, React.CSSProperties> = {
    up:    { top: 0, left: 0, right: 0, height: '35%', background: 'linear-gradient(to bottom, rgba(255,255,255,0.06) 0%, transparent 100%)' },
    down:  { bottom: 0, left: 0, right: 0, height: '35%', background: 'linear-gradient(to top, rgba(255,255,255,0.06) 0%, transparent 100%)' },
    left:  { top: 0, left: 0, bottom: 0, width: '35%', background: 'linear-gradient(to right, rgba(255,255,255,0.06) 0%, transparent 100%)' },
    right: { top: 0, right: 0, bottom: 0, width: '35%', background: 'linear-gradient(to left, rgba(255,255,255,0.06) 0%, transparent 100%)' },
  };

  return (
    <div
      className="absolute pointer-events-none"
      style={{ ...pos[dir], zIndex: 30, transition: 'opacity 300ms ease-out' }}
    />
  );
});
DirectionPulse.displayName = 'DirectionPulse';

// ── EarthVideoCard — R2-first with iframe + thumbnail fallback ────────────

interface EarthVideoCardProps {
  moment: Moment;
  visible: boolean;
  muted: boolean;
}

const EarthVideoCard = memo(({ moment, visible, muted }: EarthVideoCardProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoErr, setVideoErr] = useState(false);

  const canIframe = moment.source_platform === 'youtube' || moment.source_platform === 'youtube_shorts';
  const format = videoErr && canIframe ? 'iframe' : videoErr ? 'thumb' : 'video';

  useEffect(() => {
    setVideoReady(false);
    setVideoErr(false);
    setThumbLoaded(false);
  }, [moment.id]);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !visible || format !== 'video') return;
    void v.play().catch(() => {});
  }, [visible, format]);

  const videoUrl = `${VOYO_API}/r2/feed/${moment.source_id}`;

  return (
    <div className="absolute inset-0">
      {/* Thumbnail — always visible as base layer */}
      {moment.thumbnail_url && (
        <img
          src={moment.thumbnail_url}
          alt=""
          onLoad={() => setThumbLoaded(true)}
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            opacity: thumbLoaded ? (format === 'video' && videoReady ? 0 : 1) : 0,
            transition: 'opacity 400ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      )}

      {/* R2 video — optimistic mount, fallback on error */}
      {format === 'video' && (
        <video
          ref={videoRef}
          src={videoUrl}
          muted={muted}
          loop
          playsInline
          preload={visible ? 'auto' : 'metadata'}
          onCanPlay={() => setVideoReady(true)}
          onError={() => setVideoErr(true)}
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            opacity: videoReady ? 1 : 0,
            transition: 'opacity 400ms cubic-bezier(0.16, 1, 0.3, 1)',
            background: '#0B0703',
          }}
        />
      )}

      {/* YouTube iframe fallback */}
      {format === 'iframe' && visible && (
        <iframe
          key={`yt-${moment.source_id}`}
          src={`https://www.youtube.com/embed/${moment.source_id}?autoplay=1&mute=1&loop=1&playlist=${moment.source_id}&controls=0&playsinline=1&modestbranding=1&rel=0`}
          className="absolute inset-0 w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        />
      )}

      {/* Gradient vignette — bottom for text legibility */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: '55%',
          background: 'linear-gradient(to top, rgba(11,7,3,0.9) 0%, rgba(11,7,3,0.4) 50%, transparent 100%)',
        }}
      />
    </div>
  );
});
EarthVideoCard.displayName = 'EarthVideoCard';

// ── VoyoEarth main component ──────────────────────────────────────────────

export interface VoyoEarthProps {
  onClose: () => void;
  onPlayTrack?: (trackId: string, title: string, artist: string) => void;
}

const SWIPE_THRESHOLD = 45;
const DOUBLE_TAP_MS = 280;

export const VoyoEarth: React.FC<VoyoEarthProps> = ({ onClose, onPlayTrack }) => {
  const { current, transitioning, lastDir, loading, loadInitial, navigate, recordPlay, recordOye } =
    useEarth();

  const isMuted = usePlayerStore(s => s.isMuted ?? true);
  const [oyedIds, setOyedIds] = useState<Set<string>>(new Set());
  const [showCompass, setShowCompass] = useState(false);
  const [cardOpacity, setCardOpacity] = useState(1);
  const [dirPulse, setDirPulse] = useState<EarthDir | null>(null);
  const [dirLabel, setDirLabel] = useState<{ text: string; visible: boolean }>({ text: '', visible: false });

  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastTap = useRef(0);
  const playedIds = useRef(new Set<string>());

  // Init
  useEffect(() => {
    void loadInitial();
    const shown = localStorage.getItem(COMPASS_SHOWN_KEY);
    if (!shown) {
      setTimeout(() => setShowCompass(true), 800);
      localStorage.setItem(COMPASS_SHOWN_KEY, '1');
    }
  }, [loadInitial]);

  // Record play after 1.5s dwell
  useEffect(() => {
    if (!current || playedIds.current.has(current.id)) return;
    const t = setTimeout(() => {
      playedIds.current.add(current!.id);
      void recordPlay(current!.id);
    }, 1500);
    return () => clearTimeout(t);
  }, [current, recordPlay]);

  // Fade out when transitioning, fade in when settled
  useEffect(() => {
    setCardOpacity(transitioning ? 0 : 1);
  }, [transitioning]);

  const flashDirection = useCallback((dir: EarthDir) => {
    setDirPulse(dir);
    setDirLabel({ text: DIR_LABELS[dir], visible: true });
    setTimeout(() => setDirPulse(null), 350);
    setTimeout(() => setDirLabel(d => ({ ...d, visible: false })), 1200);
  }, []);

  const handleNavigate = useCallback((dir: EarthDir) => {
    flashDirection(dir);
    void navigate(dir);
  }, [navigate, flashDirection]);

  const handleOye = useCallback(() => {
    if (!current) return;
    setOyedIds(prev => {
      const next = new Set(prev);
      next.add(current.id);
      return next;
    });
    void recordOye(current.id);
  }, [current, recordOye]);

  // Touch gesture handler
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.changedTouches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > SWIPE_THRESHOLD) {
      if (Math.abs(dx) > Math.abs(dy)) {
        handleNavigate(dx < 0 ? 'right' : 'left');
      } else {
        handleNavigate(dy < 0 ? 'up' : 'down');
      }
    } else {
      // Tap handling
      const now = Date.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        handleOye();
      }
      lastTap.current = now;
    }
  }, [handleNavigate, handleOye]);

  const origin = current ? getOrigin(current.cultural_tags || []) : null;
  const isOyed = current ? oyedIds.has(current.id) : false;

  return (
    <div
      className="fixed inset-0 z-[60] bg-[#0B0703] overflow-hidden"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Video card */}
      <div
        className="absolute inset-0"
        style={{
          opacity: cardOpacity,
          transition: transitioning
            ? 'opacity 220ms cubic-bezier(0.4, 0, 1, 1)'
            : 'opacity 300ms cubic-bezier(0, 0, 0.2, 1)',
        }}
      >
        {current && (
          <EarthVideoCard
            moment={current}
            visible={!transitioning}
            muted={isMuted}
          />
        )}
      </div>

      {/* Direction pulse overlay */}
      <DirectionPulse dir={dirPulse} active={!!dirPulse} />

      {/* Compass hint — first visit only */}
      {showCompass && <CompassHint onDone={() => setShowCompass(false)} />}

      {/* Loading state */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div
            className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white/70"
            style={{ animation: 'spin 1s linear infinite' }}
          />
        </div>
      )}

      {/* Direction label flash */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20"
        style={{
          opacity: dirLabel.visible ? 1 : 0,
          transition: 'opacity 400ms ease',
        }}
      >
        <span className="text-[11px] font-bold tracking-[0.25em] text-white/60 uppercase">
          {dirLabel.text}
        </span>
      </div>

      {/* Top bar: close button */}
      <div className="absolute top-0 left-0 right-0 z-30 flex items-start justify-between px-4 pt-safe">
        <button
          onClick={onClose}
          className="mt-3 w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}
        >
          <X size={18} color="rgba(255,255,255,0.8)" />
        </button>

        {/* Earth wordmark */}
        <div className="mt-4 mr-1">
          <span
            className="text-[11px] font-black tracking-[0.3em] uppercase"
            style={{ color: 'rgba(255,255,255,0.35)' }}
          >
            EARTH
          </span>
        </div>
      </div>

      {/* Right action rail: OYE */}
      <div className="absolute right-3 bottom-32 z-30 flex flex-col items-center gap-4">
        <button
          onClick={handleOye}
          className="flex flex-col items-center gap-1"
        >
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center"
            style={{
              background: isOyed
                ? 'rgba(251, 191, 36, 0.25)'
                : 'rgba(0,0,0,0.45)',
              border: isOyed
                ? '1px solid rgba(251, 191, 36, 0.5)'
                : '1px solid rgba(255,255,255,0.1)',
              backdropFilter: 'blur(8px)',
              transition: 'all 200ms ease',
            }}
          >
            <Heart
              size={20}
              color={isOyed ? '#fbbf24' : 'rgba(255,255,255,0.8)'}
              fill={isOyed ? '#fbbf24' : 'none'}
            />
          </div>
          <span
            className="text-[9px] font-bold tracking-wider uppercase"
            style={{ color: isOyed ? 'rgba(251,191,36,0.9)' : 'rgba(255,255,255,0.4)' }}
          >
            oyé
          </span>
        </button>
      </div>

      {/* Bottom info bar */}
      {current && (
        <div
          className="absolute bottom-0 left-0 right-0 z-30 px-4"
          style={{
            paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
            opacity: cardOpacity,
            transition: 'opacity 300ms ease',
          }}
        >
          {/* Creator */}
          <div className="flex items-end justify-between mb-2">
            <div className="flex-1 mr-14">
              {(current.creator_username || current.creator_name) && (
                <p
                  className="text-sm font-semibold truncate"
                  style={{ color: 'rgba(255,255,255,0.9)' }}
                >
                  {current.creator_username
                    ? `@${current.creator_username}`
                    : current.creator_name}
                </p>
              )}
              {current.title && (
                <p
                  className="text-xs mt-0.5 line-clamp-2"
                  style={{ color: 'rgba(255,255,255,0.55)' }}
                >
                  {current.title}
                </p>
              )}
            </div>

            {/* Cultural origin tag */}
            {origin && (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full flex-shrink-0"
                style={{
                  background: 'rgba(0,0,0,0.5)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(8px)',
                }}
              >
                <span className="text-base leading-none">{origin.flag}</span>
                <span
                  className="text-[10px] font-semibold tracking-wide"
                  style={{ color: 'rgba(255,255,255,0.75)' }}
                >
                  {origin.label}
                </span>
              </div>
            )}
          </div>

          {/* Track link — if moment is tied to a full track */}
          {current.parent_track_id && current.parent_track_title && onPlayTrack && (
            <button
              onClick={() =>
                onPlayTrack(
                  current.parent_track_id!,
                  current.parent_track_title!,
                  current.parent_track_artist || '',
                )
              }
              className="flex items-center gap-2 py-2"
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(139,92,246,0.3)', border: '1px solid rgba(139,92,246,0.4)' }}
              >
                <Play size={10} color="rgba(139,92,246,0.9)" fill="rgba(139,92,246,0.9)" />
              </div>
              <span
                className="text-xs truncate"
                style={{ color: 'rgba(139,92,246,0.9)' }}
              >
                {current.parent_track_title}
                {current.parent_track_artist && ` — ${current.parent_track_artist}`}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default VoyoEarth;
