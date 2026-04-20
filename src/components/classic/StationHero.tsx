import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Heart } from 'lucide-react';
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

// iOS blocks programmatic unmute without user gesture — dwell-fade falls back to a tap cue.
const IS_IOS = typeof navigator !== 'undefined'
  && /iPhone|iPad|iPod/.test(navigator.userAgent)
  && !(window as unknown as { MSStream?: unknown }).MSStream;

const DWELL_MS = 7000;

function muxYTUrl(videoId: string): string {
  const params = new URLSearchParams({
    autoplay: '1',
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

export const StationHero = ({ station }: StationHeroProps) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dwellTimerRef = useRef<number | null>(null);

  const [isInView, setIsInView] = useState(false);
  // `isNearby`: card is within ~1.5 viewport-heights of the visible area.
  // Iframe only mounts when nearby — off-screen stations don't load video
  // at all (massive battery + bandwidth win when the rail has 5+ stations).
  const [isNearby, setIsNearby] = useState(false);
  const [isPreviewingAudio, setIsPreviewingAudio] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  const accentPrimary = station.accent_colors?.primary ?? '#007749'; // SA green fallback
  const accentSecondary = station.accent_colors?.secondary ?? '#FFB612'; // SA gold fallback

  // Check existing subscription on mount.
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

  // Two observers with different thresholds:
  //   - proximity (rootMargin 150% 0): iframe mount gate. Only loads when
  //     the card is within ~1.5 viewport-heights of the visible region.
  //   - visibility (>0.6 intersectionRatio): preview / dwell / pause gate.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const nearObs = new IntersectionObserver(
      (entries) => setIsNearby(entries[0].isIntersecting),
      { rootMargin: '150% 0px 150% 0px' }
    );
    const viewObs = new IntersectionObserver(
      (entries) => setIsInView(entries[0].isIntersecting && entries[0].intersectionRatio > 0.6),
      { threshold: [0.3, 0.6, 0.85] }
    );
    nearObs.observe(el);
    viewObs.observe(el);
    return () => { nearObs.disconnect(); viewObs.disconnect(); };
  }, []);

  useEffect(() => {
    if (!isInView) {
      if (dwellTimerRef.current) window.clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
      setIsPreviewingAudio(false);
      setShowIosHint(false);
      // PAUSE (not just mute) — a muted iframe still decodes video +
      // streams bytes, which was the station rail's main battery hit.
      // pauseVideo stops decode entirely until the card returns to view.
      postYTMessage('pauseVideo');
      postYTMessage('mute');
      return;
    }
    // Returning to view: resume playback before starting the dwell timer.
    postYTMessage('playVideo');
    dwellTimerRef.current = window.setTimeout(() => {
      if (IS_IOS) setShowIosHint(true);
      else fadeInAudio();
    }, DWELL_MS);
    return () => {
      if (dwellTimerRef.current) window.clearTimeout(dwellTimerRef.current);
    };
  }, [isInView]);

  const postYTMessage = useCallback((func: 'mute' | 'unMute' | 'setVolume' | 'playVideo' | 'pauseVideo', arg?: number) => {
    const iframe = iframeRef.current?.contentWindow;
    if (!iframe) return;
    const args = arg !== undefined ? [arg] : [];
    iframe.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  }, []);

  const fadeInAudio = useCallback(() => {
    setIsPreviewingAudio(true);
    postYTMessage('unMute');
    let v = 0;
    postYTMessage('setVolume', 0);
    const iv = window.setInterval(() => {
      v += 4;
      postYTMessage('setVolume', Math.min(v, 55));
      if (v >= 55) window.clearInterval(iv);
    }, 90);
  }, [postYTMessage]);

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
    // Also mute the background preview iframe so we don't double-play.
    postYTMessage('mute');
    setIsPreviewingAudio(false);
  }, [station, subscribed, postYTMessage]);

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
      {/* Iframe only mounts when the card is within proximity of the
          viewport (rootMargin 150%). Far-offscreen stations render as a
          static thumbnail poster until they get close, saving a YouTube
          player instance + video decode + bandwidth per station. */}
      {isNearby ? (
        <iframe
          ref={iframeRef}
          src={muxYTUrl(station.hero_video_id)}
          className="absolute inset-0 w-full h-full"
          style={{
            border: 0,
            filter: isPreviewingAudio ? 'brightness(0.85)' : 'brightness(0.55) blur(0.4px)',
            transition: 'filter 500ms ease',
            transform: 'scale(1.12)', // overscan so YT UI bleed is hidden
            pointerEvents: 'none',    // taps go to card
          }}
          allow="autoplay; encrypted-media; picture-in-picture"
          title={station.title}
        />
      ) : (
        <img
          src={getThumb(station.hero_video_id)}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            filter: 'brightness(0.55) blur(0.4px)',
            transform: 'scale(1.12)',
            pointerEvents: 'none',
          }}
        />
      )}

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.80) 100%)',
        }}
      />

      <div
        className="absolute top-0 left-0 pointer-events-none"
        style={{
          width: '44px',
          height: '44px',
          background: `linear-gradient(135deg, ${accentPrimary}66 0%, transparent 62%)`,
          clipPath: 'polygon(0 0, 100% 0, 0 100%)',
        }}
      />

      <div
        className="absolute top-3 right-3 w-9 h-9 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${accentSecondary}55 0%, ${accentPrimary}22 60%, transparent 100%)`,
          border: `1px solid ${accentSecondary}66`,
          animation: 'voyoSpin 14s linear infinite',
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
          <p className="text-white/50 text-[11px] font-medium">
            {station.tracklist.length} tracks
            {station.tracklist[0]?.artist && (
              <span className="text-white/35"> · opens with {station.tracklist[0].artist}</span>
            )}
          </p>
        )}
        <div className="flex items-center gap-3 text-white/60 text-[11px]">
          {station.curator && <span>{station.curator}</span>}
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
                  }}
                />
                {station.location_code ? `${station.location_code} · ` : ''}
                {station.location_label}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 pt-3">
          <button
            onClick={(e) => { e.stopPropagation(); commit(); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full text-white text-sm font-bold transition-transform active:scale-95"
            style={{
              background: `linear-gradient(135deg, ${accentSecondary} 0%, ${accentPrimary} 100%)`,
              boxShadow: `0 4px 16px ${accentPrimary}66`,
            }}
          >
            <Play className="w-4 h-4" fill="white" />
            Play station
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); commit(); }}
            className="flex items-center justify-center w-10 h-10 rounded-full transition-all active:scale-95"
            style={{
              background: subscribed ? `${accentPrimary}66` : 'rgba(255,255,255,0.08)',
              border: `1px solid ${subscribed ? accentPrimary : 'rgba(255,255,255,0.15)'}`,
            }}
            aria-label={subscribed ? 'Subscribed' : 'Add to deck'}
          >
            <Heart
              className="w-4 h-4"
              fill={subscribed ? accentSecondary : 'transparent'}
              color={subscribed ? accentSecondary : 'white'}
            />
          </button>
        </div>
      </div>

      {showIosHint && (
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none"
          style={{ animation: 'voyoBreath 2s ease-in-out infinite' }}
        >
          <div
            className="px-3 py-1.5 rounded-full text-xs font-bold"
            style={{
              background: 'rgba(0,0,0,0.55)',
              border: `1px solid ${accentSecondary}66`,
              color: accentSecondary,
              backdropFilter: 'blur(6px)',
            }}
          >
            Tap to hear
          </div>
        </div>
      )}

      <style>{`
        @keyframes voyoSpin  { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        @keyframes voyoBreath{ 0%,100% { opacity: 0.55; transform: scale(1);} 50% { opacity: 1; transform: scale(1.08);} }
      `}</style>
    </div>
  );
};

export default StationHero;
