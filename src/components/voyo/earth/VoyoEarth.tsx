/**
 * VoyoEarth — Cultural Compass Explorer v2
 *
 * The compass is driven by geographic longitude + depth:
 *   LEFT / RIGHT = drift through geographic hemisphere (geoLon ± 15°)
 *   UP            = deeper into the current geo category (compassDepth ++)
 *   DOWN          = drift toward For You (compassDepth --)
 *
 * Video hierarchy (best available, per moment):
 *   1. R2 video   — VOYO CDN edge stream (future state once pipeline runs)
 *   2. TikTok embed   — autoplays muted, full video
 *   3. Instagram embed — shows reel player (tap to play)
 *   4. YouTube embed  — for youtube/youtube_shorts platform
 *   5. Thumbnail      — static backdrop, last resort
 */

import React, {
  useState, useRef, useEffect, useCallback, memo,
} from 'react';
import { X, Heart, Play } from 'lucide-react';
import { useEarth, EarthDir, getNearestClusterLabel } from '../../../hooks/useEarth';
import { usePlayerStore } from '../../../store/playerStore';
import type { Moment } from '../../../types/moments';

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
  morocco: { flag: '🇲🇦', label: 'Marrakech' },
  'north-africa': { flag: '🌍', label: 'North Africa' },
  'west-africa': { flag: '🌍', label: 'West Africa' },
  'east-africa': { flag: '🌍', label: 'East Africa' },
  'lusophone-africa': { flag: '🌍', label: 'Lusophone Africa' },
  diaspora: { flag: '🌐', label: 'Diaspora' },
  usa: { flag: '🇺🇸', label: 'United States' },
  uk: { flag: '🇬🇧', label: 'London' },
  france: { flag: '🇫🇷', label: 'Paris' },
  caribbean: { flag: '🌴', label: 'Caribbean' },
  congo: { flag: '🇨🇩', label: 'Kinshasa' },
  drc: { flag: '🇨🇩', label: 'Kinshasa' },
  'central-africa': { flag: '🌍', label: 'Central Africa' },
  'ivory-coast': { flag: '🇨🇮', label: 'Abidjan' },
  'cape-verde': { flag: '🇨🇻', label: 'Cabo Verde' },
  jamaica: { flag: '🇯🇲', label: 'Kingston' },
};

function getOrigin(tags: string[]): { flag: string; label: string } | null {
  for (const raw of tags) {
    const key = raw.toLowerCase().replace(/\s+/g, '-');
    if (ORIGIN_MAP[key]) return ORIGIN_MAP[key];
  }
  return null;
}

// ── Compass hint ──────────────────────────────────────────────────────────

const COMPASS_SHOWN_KEY = 'voyo-earth-compass-v1';

const CompassHint = memo(({ onDone }: { onDone: () => void }) => {
  const [opacity, setOpacity] = useState(0);
  useEffect(() => {
    const rAF = requestAnimationFrame(() => setOpacity(1));
    const fade = setTimeout(() => setOpacity(0), 3800);
    const done = setTimeout(onDone, 4400);
    return () => { cancelAnimationFrame(rAF); clearTimeout(fade); clearTimeout(done); };
  }, [onDone]);
  return (
    <div
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-8 pointer-events-none"
      style={{ opacity, transition: 'opacity 600ms ease', background: 'rgba(11,7,3,0.6)' }}
    >
      {[
        { arrow: '↑', label: 'DEEPER' },
        { arrow: '← →', label: 'DRIFT GEOGRAPHIC' },
        { arrow: '↓', label: 'FOR YOU' },
      ].map(({ arrow, label }) => (
        <div key={label} className="flex flex-col items-center gap-1">
          <span className="text-2xl text-white/70">{arrow}</span>
          <span className="text-[10px] font-bold tracking-[0.25em] text-white/45 uppercase">{label}</span>
        </div>
      ))}
    </div>
  );
});
CompassHint.displayName = 'CompassHint';

// ── Direction pulse ───────────────────────────────────────────────────────

const DirectionPulse = memo(({ dir, active }: { dir: EarthDir | null; active: boolean }) => {
  if (!dir || !active) return null;
  const pos: Record<EarthDir, string> = {
    up: 'inset-x-0 top-0 h-24 bg-gradient-to-b',
    down: 'inset-x-0 bottom-0 h-24 bg-gradient-to-t',
    left: 'inset-y-0 left-0 w-24 bg-gradient-to-r',
    right: 'inset-y-0 right-0 w-24 bg-gradient-to-l',
  };
  return (
    <div
      className={`absolute z-10 pointer-events-none ${pos[dir]} from-white/8 to-transparent`}
      style={{ animation: 'pulse-once 350ms ease-out forwards' }}
    />
  );
});
DirectionPulse.displayName = 'DirectionPulse';

// ── EarthVideoCard ─────────────────────────────────────────────────────────
//
// Video format hierarchy:
//   r2_video      — VOYO CDN (populated by download pipeline)
//   tiktok_embed  — autoplays muted via TikTok's embed endpoint
//   instagram_embed — shows reel player iframe
//   youtube_embed — YouTube autoplay embed
//   thumbnail     — static last resort

type VideoFormat = 'r2_video' | 'tiktok_embed' | 'instagram_embed' | 'youtube_embed' | 'thumbnail';

function resolveFormat(moment: Moment, r2Failed: boolean): VideoFormat {
  // R2 is preferred when it exists and hasn't failed yet
  if (!r2Failed && moment.r2_video_key) return 'r2_video';
  // Platform-specific embeds — actual video content
  if (moment.source_platform === 'tiktok') return 'tiktok_embed';
  // Instagram embed shows "Watch on Instagram" UI chrome — not usable for fullscreen.
  // Falls to thumbnail until R2 pipeline populates actual video files.
  if (moment.source_platform === 'youtube' || moment.source_platform === 'youtube_shorts') return 'youtube_embed';
  return 'thumbnail';
}

interface EarthVideoCardProps {
  moment: Moment;
  visible: boolean;
  muted: boolean;
}

const EarthVideoCard = memo(({ moment, visible, muted }: EarthVideoCardProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [r2Failed, setR2Failed] = useState(false);
  const [embedLoaded, setEmbedLoaded] = useState(false);

  const format = resolveFormat(moment, r2Failed);

  useEffect(() => {
    setVideoReady(false);
    setR2Failed(false);
    setThumbLoaded(false);
    setEmbedLoaded(false);
  }, [moment.id]);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !visible || format !== 'r2_video') return;
    void v.play().catch(() => {});
  }, [visible, format]);

  const videoUrl = `${VOYO_API}/r2/feed/${moment.source_id}`;

  // Thumb opacity: fades out only when a video/embed is ready
  const thumbOpacity = (() => {
    if (!thumbLoaded) return 0;
    if (format === 'r2_video' && videoReady) return 0;
    if ((format === 'instagram_embed' || format === 'tiktok_embed' || format === 'youtube_embed') && embedLoaded) return 0;
    return 1;
  })();

  return (
    <div className="absolute inset-0">
      {/* Thumbnail — always present as backdrop */}
      {moment.thumbnail_url && (
        <img
          src={moment.thumbnail_url}
          alt=""
          onLoad={() => setThumbLoaded(true)}
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            opacity: thumbOpacity,
            transition: 'opacity 400ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      )}

      {/* R2 video stream */}
      {format === 'r2_video' && (
        <video
          ref={videoRef}
          src={videoUrl}
          muted={muted}
          loop
          playsInline
          preload={visible ? 'auto' : 'metadata'}
          onCanPlay={() => setVideoReady(true)}
          onError={() => setR2Failed(true)}
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            opacity: videoReady ? 1 : 0,
            transition: 'opacity 400ms cubic-bezier(0.16, 1, 0.3, 1)',
            background: '#0B0703',
          }}
        />
      )}

      {/* TikTok embed — autoplays muted, full video */}
      {format === 'tiktok_embed' && visible && (
        <iframe
          key={`tk-${moment.source_id}`}
          src={`https://www.tiktok.com/embed/v2/${moment.source_id}?autoplay=1&muted=1`}
          className="absolute inset-0 w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          onLoad={() => setEmbedLoaded(true)}
          style={{
            opacity: embedLoaded ? 1 : 0,
            transition: 'opacity 500ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          title={moment.title || 'Moment'}
        />
      )}

      {/* Instagram embed — reel player */}
      {format === 'instagram_embed' && visible && (
        <iframe
          key={`ig-${moment.source_id}`}
          src={`https://www.instagram.com/p/${moment.source_id}/embed/`}
          className="absolute inset-0 w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          scrolling="no"
          onLoad={() => setEmbedLoaded(true)}
          style={{
            opacity: embedLoaded ? 1 : 0,
            transition: 'opacity 500ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          title={moment.title || 'Moment'}
        />
      )}

      {/* YouTube embed */}
      {format === 'youtube_embed' && visible && (
        <iframe
          key={`yt-${moment.source_id}`}
          src={`https://www.youtube.com/embed/${moment.source_id}?autoplay=1&mute=1&loop=1&playlist=${moment.source_id}&controls=0&playsinline=1&modestbranding=1&rel=0`}
          className="absolute inset-0 w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          onLoad={() => setEmbedLoaded(true)}
          style={{
            opacity: embedLoaded ? 1 : 0,
            transition: 'opacity 500ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          title={moment.title || 'Moment'}
        />
      )}

      {/* Gradient vignette */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: '60%',
          background: 'linear-gradient(to top, rgba(11,7,3,0.92) 0%, rgba(11,7,3,0.45) 45%, transparent 100%)',
        }}
      />
    </div>
  );
});
EarthVideoCard.displayName = 'EarthVideoCard';

// ── Helpers ───────────────────────────────────────────────────────────────

function wrapLon(lon: number): number {
  return ((lon + 180 + 360) % 360) - 180;
}

// ── VoyoEarth main ────────────────────────────────────────────────────────

export interface VoyoEarthProps {
  onClose: () => void;
  onPlayTrack?: (trackId: string, title: string, artist: string) => void;
}

const SWIPE_THRESHOLD = 45;
const DOUBLE_TAP_MS = 280;

export const VoyoEarth: React.FC<VoyoEarthProps> = ({ onClose, onPlayTrack }) => {
  const {
    current, transitioning, lastDir, loading,
    geoLon, compassDepth,
    loadInitial, navigate, seedFromGenre, recordPlay, recordOye,
  } = useEarth();

  const currentTrack = usePlayerStore(s => s.currentTrack);

  const [isMuted] = useState(true);
  const [oyedIds, setOyedIds] = useState<Set<string>>(new Set());
  const [reactionDeltas, setReactionDeltas] = useState<Record<string, number>>({});
  const [showCompass, setShowCompass] = useState(false);
  const [cardOpacity, setCardOpacity] = useState(1);
  const [dirPulse, setDirPulse] = useState<EarthDir | null>(null);
  const [dirLabel, setDirLabel] = useState<{ text: string; visible: boolean }>({ text: '', visible: false });

  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastTap = useRef(0);
  const playedIds = useRef(new Set<string>());
  const seededTrackId = useRef<string | null>(null);

  // Init
  useEffect(() => {
    void loadInitial();
    const shown = localStorage.getItem(COMPASS_SHOWN_KEY);
    if (!shown) {
      setTimeout(() => setShowCompass(true), 800);
      localStorage.setItem(COMPASS_SHOWN_KEY, '1');
    }
  }, [loadInitial]);

  // Seed compass from playing track genre when entering Moments
  useEffect(() => {
    if (!currentTrack || currentTrack.id === seededTrackId.current) return;
    seededTrackId.current = currentTrack.id;
    // Use mood as genre proxy — maps broadly but seeds the geo direction
    const moodToGenre: Record<string, string> = {
      afro: 'afrobeats',
      dance: 'afrobeats',
      party: 'naija-party',
      street: 'afrobeats',
      hype: 'naija-party',
      rnb: 'afro-r&b',
      chill: 'afro-soul',
    };
    const genre = currentTrack.mood ? (moodToGenre[currentTrack.mood] ?? 'afrobeats') : 'afrobeats';
    void seedFromGenre(genre);
  }, [currentTrack, seedFromGenre]);

  // Record play after 1.5s dwell
  useEffect(() => {
    if (!current || playedIds.current.has(current.id)) return;
    const t = setTimeout(() => {
      playedIds.current.add(current!.id);
      void recordPlay(current!.id);
    }, 1500);
    return () => clearTimeout(t);
  }, [current, recordPlay]);

  // Fade on transition
  useEffect(() => {
    setCardOpacity(transitioning ? 0 : 1);
  }, [transitioning]);

  // Compute dynamic direction labels based on current compass state
  function getDirLabel(dir: EarthDir): string {
    switch (dir) {
      case 'left':  return getNearestClusterLabel(wrapLon(geoLon - 15));
      case 'right': return getNearestClusterLabel(wrapLon(geoLon + 15));
      case 'up':    return compassDepth >= 0.75 ? 'DEEP' : 'DEEPER';
      case 'down':  return compassDepth <= 0.25 ? 'FOR YOU' : 'SURFACE';
    }
  }

  const flashDirection = useCallback((dir: EarthDir) => {
    setDirPulse(dir);
    setDirLabel({ text: getDirLabel(dir), visible: true });
    setTimeout(() => setDirPulse(null), 350);
    setTimeout(() => setDirLabel(d => ({ ...d, visible: false })), 1200);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoLon, compassDepth]);

  const handleNavigate = useCallback((dir: EarthDir) => {
    flashDirection(dir);
    void navigate(dir);
  }, [navigate, flashDirection]);

  const handleOye = useCallback(() => {
    if (!current || oyedIds.has(current.id)) return;
    setOyedIds(prev => { const n = new Set(prev); n.add(current.id); return n; });
    setReactionDeltas(prev => ({ ...prev, [current.id]: (prev[current.id] ?? 0) + 1 }));
    void recordOye(current.id);
  }, [current, oyedIds, recordOye]);

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
      const now = Date.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) handleOye();
      lastTap.current = now;
    }
  }, [handleNavigate, handleOye]);

  const origin = current ? getOrigin(current.cultural_tags || []) : null;
  const isOyed = current ? oyedIds.has(current.id) : false;
  const reactionCount = current
    ? (current.voyo_reactions || 0) + (reactionDeltas[current.id] ?? 0)
    : 0;

  function fmtCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n > 0 ? String(n) : '';
  }

  // Compass position indicator — shows cluster name + depth bar
  const clusterLabel = getNearestClusterLabel(geoLon);
  const depthPct = Math.round(compassDepth * 100);

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

      {/* Direction pulse */}
      <DirectionPulse dir={dirPulse} active={!!dirPulse} />

      {/* Compass hint — first visit only */}
      {showCompass && <CompassHint onDone={() => setShowCompass(false)} />}

      {/* Loading */}
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
        style={{ opacity: dirLabel.visible ? 1 : 0, transition: 'opacity 400ms ease' }}
      >
        <span className="text-[11px] font-bold tracking-[0.25em] text-white/60 uppercase">
          {dirLabel.text}
        </span>
      </div>

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-30 flex items-start justify-between px-4 pt-safe">
        <button
          onClick={onClose}
          className="mt-3 w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}
        >
          <X size={18} color="rgba(255,255,255,0.8)" />
        </button>

        {/* Compass position — cluster name + depth */}
        <div className="mt-3 mr-1 flex flex-col items-end gap-1">
          <span
            className="text-[10px] font-black tracking-[0.2em] uppercase"
            style={{ color: 'rgba(255,255,255,0.4)' }}
          >
            {clusterLabel}
          </span>
          {/* Depth bar */}
          <div
            className="w-16 h-0.5 rounded-full overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.12)' }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${depthPct}%`,
                background: depthPct < 30
                  ? 'rgba(139,92,246,0.7)'   // purple = For You
                  : 'rgba(212,160,83,0.7)',   // amber = geo deep
                transition: 'width 400ms ease, background 400ms ease',
              }}
            />
          </div>
        </div>
      </div>

      {/* OYE action rail */}
      <div className="absolute right-3 bottom-32 z-30 flex flex-col items-center gap-4">
        <button onClick={handleOye} className="flex flex-col items-center gap-1">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center"
            style={{
              background: isOyed ? 'rgba(251,191,36,0.25)' : 'rgba(0,0,0,0.45)',
              border: isOyed ? '1px solid rgba(251,191,36,0.5)' : '1px solid rgba(255,255,255,0.1)',
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
            {reactionCount > 0 ? fmtCount(reactionCount) : 'oyé'}
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
          <div className="flex items-end justify-between mb-2">
            <div className="flex-1 mr-14">
              {(current.creator_username || current.creator_name) && (
                <p className="text-sm font-semibold truncate" style={{ color: 'rgba(255,255,255,0.9)' }}>
                  {current.creator_username ? `@${current.creator_username}` : current.creator_name}
                </p>
              )}
              {current.title && (
                <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  {current.title}
                </p>
              )}
              {current.view_count > 0 && (
                <p className="text-[10px] mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {fmtCount(current.view_count)} views
                </p>
              )}
            </div>

            {origin && (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full flex-shrink-0"
                style={{
                  background: current.featured ? 'rgba(212,160,83,0.15)' : 'rgba(0,0,0,0.5)',
                  border: current.featured ? '1px solid rgba(212,160,83,0.35)' : '1px solid rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(8px)',
                }}
              >
                {current.featured && (
                  <span className="text-[10px] leading-none" style={{ color: 'rgba(212,160,83,0.9)' }}>★</span>
                )}
                <span className="text-base leading-none">{origin.flag}</span>
                <span
                  className="text-[10px] font-semibold tracking-wide"
                  style={{ color: current.featured ? 'rgba(212,160,83,0.9)' : 'rgba(255,255,255,0.75)' }}
                >
                  {origin.label}
                </span>
              </div>
            )}
          </div>

          {current.parent_track_id && current.parent_track_title && onPlayTrack && (
            <button
              onClick={() => onPlayTrack(current.parent_track_id!, current.parent_track_title!, current.parent_track_artist || '')}
              className="flex items-center gap-2 py-2"
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(139,92,246,0.3)', border: '1px solid rgba(139,92,246,0.4)' }}
              >
                <Play size={10} color="rgba(139,92,246,0.9)" fill="rgba(139,92,246,0.9)" />
              </div>
              <span className="text-xs truncate" style={{ color: 'rgba(139,92,246,0.9)' }}>
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
