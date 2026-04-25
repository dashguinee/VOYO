import { memo, useEffect, useRef, useState, useCallback } from 'react';
import { Play, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { app } from '../../services/oyo';
import { getUserHash } from '../../services/centralDJ';
import { getThumb } from '../../utils/thumbnail';

type TracklistItem = {
  t_seconds?: number;
  title: string;
  artist: string;
  youtube_id?: string | null;
  r2_cached?: boolean;
};

export type Station = {
  id: string;
  hero_video_id: string;
  title: string;
  tagline?: string | null;
  curator?: string | null;
  location_code?: string | null;
  location_label?: string | null;
  vibe_axes?: Record<string, number>;
  accent_colors?: { primary?: string; secondary?: string };
  tracklist?: TracklistItem[];
};

interface StationHeroProps {
  station: Station;
}

function muxYTUrl(videoId: string): string {
  const params = new URLSearchParams({
    autoplay: '1',           // autoplay-on-mount → no loader visible at viewport
    mute: '1',
    loop: '1',
    playlist: videoId,       // required for loop= to work on a single video
    controls: '0',
    modestbranding: '1',
    playsinline: '1',
    rel: '0',
    enablejsapi: '1',
  });
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

/**
 * StationHero — rewritten v623 (radio-tuning model).
 *
 * Lifecycle ("like a radio always tuning, only on your viewport"):
 *   · Card NEAR (rootMargin 50%)  → iframe mounts + autoplays muted.
 *     By the time the user scrolls into view, the video is already
 *     playing. No YT loader visible at the viewport.
 *   · Card IN VIEW (>50% visible) → iframe stays playing (resume if
 *     it was paused on a brief scroll-out).
 *   · Card OUT of view (still near) → postMessage pauseVideo. Iframe
 *     stays mounted; no reload, no re-decode on return.
 *   · Card LEAVES near (after 800ms grace) → iframe unmounts. Memory
 *     freed for cards that drift far off-screen.
 *
 * Single-iframe-per-rail approach (parent isActive prop) was tried
 * briefly and rejected — Dash wanted continuous-tuning feel, not
 * one-at-a-time switch-and-reload.
 */
export const StationHero = memo(({ station }: StationHeroProps) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isNear, setIsNear] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [shouldMount, setShouldMount] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  const accentPrimary = station.accent_colors?.primary ?? '#007749';
  const accentSecondary = station.accent_colors?.secondary ?? '#FFB612';

  // Existing-subscription check.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const uh = getUserHash();
      const { data } = await supabase
        .from('voyo_station_subscriptions')
        .select('id')
        .eq('user_hash', uh)
        .eq('station_id', station.id)
        .limit(1);
      if (!cancelled && data && data.length > 0) setSubscribed(true);
    })();
    return () => { cancelled = true; };
  }, [station.id]);

  // Two observers: proximity (mount gate) + visibility (play/pause gate).
  // Proximity uses rootMargin 50% → iframe mounts ~half a viewport
  // before the card enters view, gives YT enough time to boot so the
  // video is already running by the time the user arrives.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const nearObs = new IntersectionObserver(
      (entries) => setIsNear(entries[0].isIntersecting),
      { rootMargin: '50% 0px 50% 0px' }
    );
    const viewObs = new IntersectionObserver(
      (entries) => setIsInView(entries[0].intersectionRatio > 0.5),
      { threshold: [0, 0.5, 1] }
    );
    nearObs.observe(el);
    viewObs.observe(el);
    return () => { nearObs.disconnect(); viewObs.disconnect(); };
  }, []);

  // Mount management with grace period — iframe stays alive 800ms after
  // leaving the proximity zone, so a quick scroll-through-and-back
  // doesn't reload the YT player.
  useEffect(() => {
    if (isNear) {
      setShouldMount(true);
      return;
    }
    const t = setTimeout(() => {
      setShouldMount(false);
      setIframeReady(false);
    }, 800);
    return () => clearTimeout(t);
  }, [isNear]);

  // Pause/resume via postMessage based on visibility — no mount/unmount,
  // no reload. The iframe is already running (autoplay=1), we just
  // suspend frame decode while the card is off-screen.
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win || !iframeReady) return;
    const cmd = isInView ? 'playVideo' : 'pauseVideo';
    win.postMessage(`{"event":"command","func":"${cmd}","args":""}`, '*');
  }, [isInView, iframeReady]);

  const commit = useCallback(async () => {
    if (supabase && !subscribed) {
      const { error } = await supabase
        .from('voyo_station_subscriptions')
        .insert({ user_hash: getUserHash(), station_id: station.id });
      if (!error || error.code === '23505') setSubscribed(true);
    }
    app.playTrack({
      id: station.hero_video_id,
      trackId: station.hero_video_id,
      title: station.title,
      artist: station.curator ?? 'Station',
      album: station.title,
      coverUrl: getThumb(station.hero_video_id),
      tags: ['station', station.id],
      mood: 'afro',
      region: station.location_code ?? 'ZA',
      oyeScore: 0,
      duration: 0,
      createdAt: new Date().toISOString(),
    }, 'vibe');
  }, [station, subscribed]);

  return (
    <div
      ref={cardRef}
      className="relative w-full rounded-2xl overflow-hidden cursor-pointer group"
      onClick={commit}
      style={{
        aspectRatio: '4 / 5',
        background: [
          'linear-gradient(135deg,',
          'rgba(212, 175, 110, 0.22) 0%,',
          'rgba(232, 208, 158, 0.13) 32%,',
          `${accentPrimary}1a 68%,`,
          `${accentSecondary}14 100%)`,
        ].join(' '),
        border: `1px solid ${accentSecondary}4D`,
        boxShadow: `inset 0 0 32px rgba(212,175,110,0.08), 0 8px 32px ${accentPrimary}22`,
      }}
    >
      {/* Poster — always mounted as backdrop. Carries the station
          visually while iframe boots; stays underneath the iframe so
          there's never a black flash on mount/unmount transitions. */}
      <img
        src={getThumb(station.hero_video_id)}
        alt=""
        decoding="async"
        loading="lazy"
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          filter: 'brightness(0.52) blur(0.4px)',
          transform: 'scale(1.62) translateY(5%)',
          pointerEvents: 'none',
        }}
      />
      {/* Iframe — mounted when card is near (50% rootMargin); fades in
          over poster once YT signals onLoad. Stays mounted until card
          drifts far off-screen + 800ms grace. */}
      {shouldMount && (
        <iframe
          ref={iframeRef}
          src={muxYTUrl(station.hero_video_id)}
          className="absolute inset-0 w-full h-full"
          style={{
            border: 0,
            filter: 'brightness(0.52) blur(0.4px)',
            transform: 'scale(1.62) translateY(5%)',
            pointerEvents: 'none',
            opacity: iframeReady ? 1 : 0,
            transition: 'opacity 600ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          allow="autoplay; encrypted-media; picture-in-picture"
          title={station.title}
          onLoad={() => setIframeReady(true)}
        />
      )}

      {/* Top fade — catches YT title flash. */}
      <div
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{
          height: '22%',
          background:
            'linear-gradient(180deg, rgba(18,12,6,0.78) 0%, rgba(40,26,14,0.45) 40%, rgba(0,0,0,0) 100%)',
        }}
      />

      {/* Bottom fade — bronze wash blending into title block. */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: '62%',
          background:
            'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(22,14,8,0.38) 32%, rgba(30,18,8,0.72) 62%, rgba(14,8,4,0.92) 100%)',
        }}
      />

      {/* Soft bronze full-frame wash — unifies iframe palette. */}
      <div
        className="absolute inset-0 pointer-events-none mix-blend-overlay"
        style={{
          background:
            'radial-gradient(120% 80% at 50% 45%, rgba(212,175,110,0.10) 0%, rgba(212,175,110,0.04) 50%, transparent 80%)',
        }}
      />

      {/* Top-left bronze flourish. */}
      <div
        className="absolute top-0 left-0 pointer-events-none"
        style={{
          width: '40px',
          height: '40px',
          background: `linear-gradient(135deg, ${accentPrimary}44 0%, transparent 62%)`,
          clipPath: 'polygon(0 0, 100% 0, 0 100%)',
        }}
      />

      {/* Top-right bronze halo — spinning only when card is in view
          (animation paused otherwise, no GPU work). */}
      <div
        className="absolute top-3 right-3 w-8 h-8 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${accentSecondary}40 0%, ${accentPrimary}18 60%, transparent 100%)`,
          border: `1px solid ${accentSecondary}4D`,
          animation: 'voyoSpin 14s linear infinite',
          animationPlayState: isInView ? 'running' : 'paused',
        }}
      />

      <div className="absolute inset-x-0 bottom-0 p-5 space-y-2">
        <div
          className="inline-block px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-widest"
          style={{
            background: `${accentPrimary}33`,
            border: `1px solid ${accentPrimary}77`,
            color: accentSecondary,
            letterSpacing: '0.14em',
          }}
        >
          Station
        </div>
        <h2
          className="font-display font-bold text-white text-2xl leading-tight tracking-tight"
          style={{ textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}
        >
          {station.title}
        </h2>
        {station.tagline && (
          <p className="text-white/75 text-sm font-medium">{station.tagline}</p>
        )}
        {station.tracklist && station.tracklist.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-white/45 text-[11px] font-medium">
              {station.tracklist.length} tracks
            </span>
            {station.tracklist[0]?.artist && (
              <>
                <span className="text-white/25 text-[11px]">·</span>
                <span className="text-white/45 text-[11px]">opens with</span>
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white/95"
                  style={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.08) 100%)',
                    border: '1px solid rgba(255,255,255,0.18)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 1px 2px rgba(0,0,0,0.25)',
                    letterSpacing: '0.01em',
                  }}
                >
                  {station.tracklist[0].artist}
                </span>
              </>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-white/60">
          {station.curator && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full font-semibold text-white/90"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.07) 100%)',
                border: '1px solid rgba(255,255,255,0.16)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), 0 1px 2px rgba(0,0,0,0.25)',
                letterSpacing: '0.01em',
              }}
            >
              {station.curator}
            </span>
          )}
          {station.location_label && (
            <>
              <span className="text-white/25">•</span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{
                    background: accentPrimary,
                    boxShadow: `0 0 6px ${accentPrimary}`,
                    animation: 'voyoBreath 2s ease-in-out infinite',
                    animationPlayState: isInView ? 'running' : 'paused',
                  }}
                />
                {station.location_code ? `${station.location_code} · ` : ''}
                {station.location_label}
              </span>
            </>
          )}
        </div>

        {/* Join — finished-product treatment.
            Not joined: silver/platinum metallic pill. The gradient + bevel
              + lift shadow already do the premium read; previous shimmer
              was animation-noise on top of an already-finished object
              (per Dash's "premium = restraint" memo).
            Joined: bronze-fill stamped pill, smaller. The "owned/complete"
              state reads warmer + more compact — the journey done. */}
        <div className="flex items-center gap-2 pt-3">
          <button
            onClick={(e) => { e.stopPropagation(); commit(); }}
            className={`relative flex items-center gap-2 rounded-full font-bold transition-transform active:scale-[0.96] ${
              subscribed ? 'pl-1.5 pr-3.5 py-1.5 text-[12px]' : 'pl-2 pr-4 py-2 text-[13px]'
            }`}
            style={subscribed ? {
              color: '#1b0e04',
              background: 'linear-gradient(135deg, #f0d39a 0%, #d4a053 45%, #b07d2c 100%)',
              boxShadow: '0 5px 14px rgba(176,125,44,0.4), inset 0 1px 0 rgba(255,220,160,0.45), inset 0 -1px 0 rgba(0,0,0,0.2)',
              border: '1px solid rgba(255,220,160,0.45)',
              letterSpacing: '0.02em',
            } : {
              color: '#1b1b22',
              background: 'linear-gradient(135deg, #f7f7fa 0%, #e4e4ea 28%, #b9b9c1 55%, #d8d8df 78%, #f1f1f4 100%)',
              boxShadow: '0 6px 18px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(0,0,0,0.18)',
              border: '1px solid rgba(255,255,255,0.35)',
              letterSpacing: '0.02em',
            }}
            aria-label={subscribed ? 'Joined — tap to play' : 'Join station'}
          >
            <span
              className={`relative rounded-full flex items-center justify-center ${
                subscribed ? 'w-5 h-5' : 'w-7 h-7'
              }`}
              style={subscribed ? {
                background: 'rgba(27,14,4,0.85)',
                boxShadow: 'inset 0 1px 1px rgba(255,220,160,0.3)',
              } : {
                background: 'linear-gradient(135deg, #1b1b22 0%, #2a2a33 100%)',
                boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.12), 0 1px 2px rgba(0,0,0,0.4)',
              }}
            >
              {subscribed ? (
                <Check className="w-3 h-3" style={{ color: '#f0d39a' }} strokeWidth={3} />
              ) : (
                <Play className="w-3.5 h-3.5" fill="#f7f7fa" style={{ color: '#f7f7fa' }} />
              )}
            </span>
            <span>{subscribed ? 'Joined' : 'Join'}</span>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes voyoSpin   { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        @keyframes voyoBreath { 0%,100% { opacity: 0.55; transform: scale(1);} 50% { opacity: 1; transform: scale(1.08);} }
      `}</style>
    </div>
  );
});
StationHero.displayName = 'StationHero';

export default StationHero;
