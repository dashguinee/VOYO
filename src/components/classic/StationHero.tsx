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

/**
 * StationHero — v625.1 (Ken Burns + zero iframes).
 *
 * Tried YT's animated WebP endpoint (i.ytimg.com/an_webp/...) but it's
 * unreliable — only exists for high-traffic videos, 404s for most
 * curated music, leaving the rail looking dead.
 *
 * Pivot: skip "real video preview" entirely. Use the static thumbnail
 * with a slow Ken Burns scale animation when the card is in view.
 * Reads as "alive" without depending on any external URL endpoint.
 * Same architectural win — zero iframes on Home, zero process slots,
 * zero YT JS boot. Tap → main player handles real playback.
 *
 * Aligned with "premium = restraint" memo: one signature gesture
 * (slow scale) instead of a stack of competing motion sources.
 */
export const StationHero = memo(({ station }: StationHeroProps) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardInView, setCardInView] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  const accentPrimary = station.accent_colors?.primary ?? '#007749';
  const accentSecondary = station.accent_colors?.secondary ?? '#FFB612';
  const videoId = station.hero_video_id;

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

  // Single observer — drives motion-thumb mount + decorative animation
  // pause-when-offscreen. 0.4 threshold is the "card is meaningfully on
  // screen" signal; below that it's still scrolling in/out and the
  // motion thumb is wasted decode.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setCardInView(entry.intersectionRatio > 0.4),
      { threshold: [0, 0.4, 0.8] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const commit = useCallback(async () => {
    if (supabase && !subscribed) {
      const { error } = await supabase
        .from('voyo_station_subscriptions')
        .insert({ user_hash: getUserHash(), station_id: station.id });
      if (!error || error.code === '23505') setSubscribed(true);
    }
    app.playTrack({
      id: videoId,
      trackId: videoId,
      title: station.title,
      artist: station.curator ?? 'Station',
      album: station.title,
      coverUrl: getThumb(videoId),
      tags: ['station', station.id],
      mood: 'afro',
      region: station.location_code ?? 'ZA',
      oyeScore: 0,
      duration: 0,
      createdAt: new Date().toISOString(),
    }, 'vibe');
  }, [station, subscribed, videoId]);

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
      {/* Static poster with Ken Burns motion when card is in view.
          The kb-still class freezes the transform; kb-live runs a slow
          12s scale + drift cycle. animation-play-state pause when off-
          screen ensures zero GPU work for inactive cards. */}
      <img
        src={getThumb(videoId)}
        alt=""
        decoding="async"
        loading="lazy"
        aria-hidden="true"
        className={`absolute inset-0 w-full h-full object-cover ${cardInView ? 'station-kb-live' : 'station-kb-still'}`}
        style={{
          filter: 'brightness(0.52) blur(0.4px)',
          pointerEvents: 'none',
        }}
      />
      <style>{`
        .station-kb-still {
          transform: scale(1.62) translateY(5%);
        }
        .station-kb-live {
          animation: station-kb 14s ease-in-out infinite alternate;
        }
        @keyframes station-kb {
          0%   { transform: scale(1.62) translateY(5%) translateX(0); }
          100% { transform: scale(1.74) translateY(2%) translateX(-1.5%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .station-kb-live { animation: none; transform: scale(1.62) translateY(5%); }
        }
      `}</style>

      {/* Top fade. */}
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

      {/* Soft bronze full-frame wash. */}
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

      {/* Top-right bronze halo — spinning only when in view. */}
      <div
        className="absolute top-3 right-3 w-8 h-8 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${accentSecondary}40 0%, ${accentPrimary}18 60%, transparent 100%)`,
          border: `1px solid ${accentSecondary}4D`,
          animation: 'voyoSpin 14s linear infinite',
          animationPlayState: cardInView ? 'running' : 'paused',
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
                    animationPlayState: cardInView ? 'running' : 'paused',
                  }}
                />
                {station.location_code ? `${station.location_code} · ` : ''}
                {station.location_label}
              </span>
            </>
          )}
        </div>

        {/* Join button — silver/platinum metallic when not joined,
            bronze-fill stamped pill smaller when joined. */}
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
