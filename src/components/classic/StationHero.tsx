import { memo, useEffect, useRef, useState, useCallback } from 'react';
import { Play } from 'lucide-react';
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

// Dwell before audio ramps in. Was 7000ms — felt slow enough that users
// saw the YT loader finish, the video play, and still sat in silence for
// several seconds. 2s is long enough to register intent (not a pass-by
// scroll) without letting the user stare at a muted player.
const DWELL_MS = 2000;

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

export const StationHero = memo(({ station }: StationHeroProps) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dwellTimerRef = useRef<number | null>(null);
  // Tracks the fade-in interval so we can cancel it on unmount OR when
  // the card leaves view before the ramp reaches target. Without this
  // ref the ramp leaks a setInterval that keeps calling postMessage
  // into a dead iframe forever.
  const fadeIntervalRef = useRef<number | null>(null);

  const [isInView, setIsInView] = useState(false);
  // `isNearby`: card is within ~2.5 viewport-heights of the visible area.
  // Iframe only mounts when nearby — off-screen stations don't load video
  // at all (massive battery + bandwidth win when the rail has 5+ stations).
  const [isNearby, setIsNearby] = useState(false);
  // Live mirror of isInView for the iframe onLoad callback. Without this
  // ref, onLoad captures the initial (false) value and can't tell whether
  // the card became visible while the YT player was booting.
  const isInViewRef = useRef(false);
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
  //   - proximity (rootMargin 250% 0): iframe mount gate. Larger margin
  //     than before so the YouTube embed loads + starts muted autoplay
  //     well before the card scrolls into view. Kills the "see the YT
  //     loader" moment + the mid-scroll iframe-mount jank.
  //   - visibility (>0.35 intersectionRatio): preview / dwell / pause
  //     gate. Lower than 0.6 so the dwell timer starts as soon as the
  //     card is meaningfully on-screen — audio ramp begins by the time
  //     the user is actually focused on it.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const nearObs = new IntersectionObserver(
      (entries) => setIsNearby(entries[0].isIntersecting),
      { rootMargin: '250% 0px 250% 0px' }
    );
    const viewObs = new IntersectionObserver(
      (entries) => setIsInView(entries[0].isIntersecting && entries[0].intersectionRatio > 0.35),
      { threshold: [0.2, 0.35, 0.6, 0.85] }
    );
    nearObs.observe(el);
    viewObs.observe(el);
    return () => { nearObs.disconnect(); viewObs.disconnect(); };
  }, []);

  useEffect(() => { isInViewRef.current = isInView; }, [isInView]);

  useEffect(() => {
    if (!isInView) {
      if (dwellTimerRef.current) window.clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
      // Cancel any active audio-ramp — was leaking a setInterval that
      // kept messaging a paused/dead iframe when the card scrolled away.
      if (fadeIntervalRef.current != null) {
        window.clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
      }
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
      // Defensive cleanup on effect teardown (component unmount or
      // isInView flip). Mirrors the !isInView branch above.
      if (fadeIntervalRef.current != null) {
        window.clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
      }
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
    // Cancel any prior ramp before starting a new one (e.g. scroll out
    // + back in during a single dwell cycle).
    if (fadeIntervalRef.current != null) {
      window.clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = null;
    }
    fadeIntervalRef.current = window.setInterval(() => {
      v += 4;
      postYTMessage('setVolume', Math.min(v, 55));
      if (v >= 55 && fadeIntervalRef.current != null) {
        window.clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
      }
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
          player instance + video decode + bandwidth per station.
          scale 1.22 overscans YT UI bleed; translateY 7% drops the
          video so the native YouTube title (when it flashes) falls
          into the top fade instead of being clipped. */}
      {isNearby ? (
        <iframe
          ref={iframeRef}
          src={muxYTUrl(station.hero_video_id)}
          className="absolute inset-0 w-full h-full"
          style={{
            border: 0,
            filter: isPreviewingAudio ? 'brightness(0.82)' : 'brightness(0.52) blur(0.4px)',
            transition: 'filter 500ms ease',
            // scale 1.22 left ~55% of the iframe as YT letterbox black
            // (16:9 video in 4:5 frame). 1.62 zooms the video enough to
            // clip ~40% of the top black strip while still keeping the
            // main subject framed. translateY keeps YT's title flash
            // inside the top fade.
            transform: 'scale(1.62) translateY(5%)',
            pointerEvents: 'none',
          }}
          allow="autoplay; encrypted-media; picture-in-picture"
          title={station.title}
          onLoad={() => {
            // autoplay=1 in the URL starts the video the moment the iframe
            // boots. If we're mounted-nearby-but-not-in-view, that's pure
            // wasted decode + stream. Push pauseVideo as soon as the YT
            // API is reachable — retry once because postMessage can land
            // before YT's command handler is listening.
            if (isInViewRef.current) return;
            postYTMessage('pauseVideo');
            postYTMessage('mute');
            window.setTimeout(() => {
              if (isInViewRef.current) return;
              postYTMessage('pauseVideo');
              postYTMessage('mute');
            }, 800);
          }}
        />
      ) : (
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
      )}

      {/* Top fade — bronze-tinted darkening catches the YT title flash
          and keeps the card calm. Short (22% height), strong near the
          edge, vanishes into the mid-frame. */}
      <div
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{
          height: '22%',
          background:
            'linear-gradient(180deg, rgba(18,12,6,0.78) 0%, rgba(40,26,14,0.45) 40%, rgba(0,0,0,0) 100%)',
        }}
      />

      {/* Bottom fade — bronze wash that blends into the title block.
          Darker than the old pure-black gradient, pulled warmer so the
          whole card reads as "lit-by-firelight" rather than "movie
          poster". */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: '62%',
          background:
            'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(22,14,8,0.38) 32%, rgba(30,18,8,0.72) 62%, rgba(14,8,4,0.92) 100%)',
        }}
      />

      {/* Soft bronze wash over the full frame — very low opacity (4-5%)
          unifies iframe color temperature with the rest of the card so
          the video stops fighting the VOYO palette. */}
      <div
        className="absolute inset-0 pointer-events-none mix-blend-overlay"
        style={{
          background:
            'radial-gradient(120% 80% at 50% 45%, rgba(212,175,110,0.10) 0%, rgba(212,175,110,0.04) 50%, transparent 80%)',
        }}
      />

      {/* Top-left bronze corner flourish — kept subtler than before. */}
      <div
        className="absolute top-0 left-0 pointer-events-none"
        style={{
          width: '40px',
          height: '40px',
          background: `linear-gradient(135deg, ${accentPrimary}44 0%, transparent 62%)`,
          clipPath: 'polygon(0 0, 100% 0, 0 100%)',
        }}
      />

      {/* Top-right rotating bronze halo — unchanged, just toned down. */}
      <div
        className="absolute top-3 right-3 w-8 h-8 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${accentSecondary}40 0%, ${accentPrimary}18 60%, transparent 100%)`,
          border: `1px solid ${accentSecondary}4D`,
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
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-white/45 text-[11px] font-medium">
              {station.tracklist.length} tracks
            </span>
            {station.tracklist[0]?.artist && (
              <>
                <span className="text-white/25 text-[11px]">·</span>
                <span className="text-white/45 text-[11px]">opens with</span>
                {/* Frosted glass pill — premium, unambiguous "this is an
                    artist name" tag. Subtle white gradient, backdrop-blur
                    so the bronze wash reads through without drowning the
                    text. Visually distinct from plain metadata copy. */}
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white/95"
                  style={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.06) 100%)',
                    border: '1px solid rgba(255,255,255,0.16)',
                    backdropFilter: 'blur(8px) saturate(140%)',
                    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
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
                background: 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.05) 100%)',
                border: '1px solid rgba(255,255,255,0.14)',
                backdropFilter: 'blur(8px) saturate(140%)',
                WebkitBackdropFilter: 'blur(8px) saturate(140%)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10)',
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
                  }}
                />
                {station.location_code ? `${station.location_code} · ` : ''}
                {station.location_label}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 pt-3">
          {/* Join — silver/platinum metallic pill. Reads as a precious
              object against the bronze/brown frame, not a busy accent
              piece. Multi-stop gradient with a warm-white highlight on
              the 30% band gives it dimensional "pressed metal" feel.
              Inner inset ring + soft shadow = frame, not flatness. */}
          <button
            onClick={(e) => { e.stopPropagation(); commit(); }}
            className="relative overflow-hidden flex items-center gap-2 pl-2 pr-4 py-2 rounded-full text-[13px] font-bold transition-transform active:scale-95"
            style={{
              color: '#1b1b22',
              background:
                'linear-gradient(135deg, #f7f7fa 0%, #e4e4ea 28%, #b9b9c1 55%, #d8d8df 78%, #f1f1f4 100%)',
              boxShadow:
                '0 6px 18px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(0,0,0,0.18)',
              border: '1px solid rgba(255,255,255,0.35)',
              letterSpacing: '0.02em',
            }}
            aria-label={subscribed ? 'Enter joined station' : 'Join station'}
          >
            {/* Shimmer overlay — a thin warm-white highlight band sweeps
                across the silver once every ~8s. 88% of the cycle is idle
                (band parked off-screen at opacity 0), so the motion reads
                as invitation, not noise. Subtler than Oye's continuous
                bubble — it catches the eye, then gets out of the way. */}
            {!subscribed && (
              <span
                aria-hidden="true"
                className="absolute inset-y-0 -inset-x-2 pointer-events-none"
                style={{
                  background:
                    'linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.78) 50%, transparent 65%)',
                  mixBlendMode: 'overlay',
                  animation: 'voyo-join-shimmer 8s cubic-bezier(0.4, 0, 0.2, 1) infinite',
                }}
              />
            )}
            <span
              className="relative w-7 h-7 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #1b1b22 0%, #2a2a33 100%)',
                boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.12), 0 1px 2px rgba(0,0,0,0.4)',
              }}
            >
              <Play className="w-3.5 h-3.5" fill="#f7f7fa" style={{ color: '#f7f7fa' }} />
            </span>
            <span className="relative">{subscribed ? 'Joined' : 'Join'}</span>
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
});
StationHero.displayName = 'StationHero';

export default StationHero;
