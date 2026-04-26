/**
 * VOYO Live Card
 * For the People, by The People
 *
 * Central avatar + 3 overlapping orbiting avatars + dynamic gradients
 */

import { useState, useEffect, useRef } from 'react';
import { Play } from 'lucide-react';
import { usePlayerStore } from '../../store/playerStore';
import { useAuth } from '../../hooks/useAuth';
import { friendsAPI, activityAPI, Friend, FriendActivity } from '../../lib/voyo-api';
import { devWarn } from '../../utils/logger';
import { TrackThumbnail } from '../ui/TrackThumbnail';
import { AnchoredTaleHeader } from '../classic/AnchoredTaleHeader';

// Default avatars — the real VOYO crew: Dash + Guinean figures + artists.
// Replaced the stock Unsplash placeholders so the "Oyé! We Live" card
// reads as the actual community from day one. Dash sits at index 0 so
// the center-avatar rotation starts on him (brand anchor).
const DEFAULT_AVATARS = [
  '/vibes/dash.png',
  '/vibes/brandy-moja.jpg',
  '/vibes/mamadi.jpg',
  '/vibes/artist-blue.jpg',
  '/vibes/artist-beanie.jpg',
];

// Mock friends listening. `thumbnail` is the primary YouTube art;
// `communityFallback` is the /vibes/ local asset used when the YT
// thumbnail 404s (e.g. mCfPHnO3EB4 is dead — video removed/region-blocked).
const MOCK_FRIENDS_LISTENING = [
  { id: '1', name: 'Dash',   avatar: DEFAULT_AVATARS[0], track: { title: 'Last Last', thumbnail: 'https://i.ytimg.com/vi/421w1j87fEM/hqdefault.jpg', communityFallback: '/vibes/dash.png' } },
  { id: '2', name: 'Brandy', avatar: DEFAULT_AVATARS[1], track: { title: 'Essence',   thumbnail: 'https://i.ytimg.com/vi/jipQpjUA_o8/hqdefault.jpg', communityFallback: '/vibes/brandy-moja.jpg' } },
  { id: '3', name: 'Mamadi', avatar: DEFAULT_AVATARS[2], track: { title: 'Calm Down', thumbnail: 'https://i.ytimg.com/vi/WcIcVapfqXw/hqdefault.jpg', communityFallback: '/vibes/mamadi.jpg' } },
  { id: '4', name: 'Fatou',  avatar: DEFAULT_AVATARS[3], track: { title: 'Peru',      thumbnail: 'https://i.ytimg.com/vi/mCfPHnO3EB4/hqdefault.jpg', communityFallback: '/vibes/artist-blue.jpg' } },
];

// Gradient colors
// Progress thresholds for Next Up reveals — 4 evenly-spaced moments
// across the track. Module scope so the bucketing selector below can
// reference it during render-time subscription.
const NEXT_SHOW_AT = [0.07, 0.38, 0.65, 0.86];

const GRADIENT_COLORS = [
  { from: '#7c3aed', via: '#8b5cf6', to: '#a78bfa' },  // Deep violet
  { from: '#5b21b6', via: '#7c3aed', to: '#8b5cf6' },  // Purple core
  { from: '#4c1d95', via: '#6d28d9', to: '#7c3aed' },  // Dark purple
  { from: '#6d28d9', via: '#8b5cf6', to: '#a78bfa' },  // Mid purple
  { from: '#4f46e5', via: '#7c3aed', to: '#8b5cf6' },  // Indigo-violet
  { from: '#3730a3', via: '#4f46e5', to: '#6d28d9' },  // Deep indigo
  { from: '#581c87', via: '#7c3aed', to: '#6d28d9' },  // Rich purple
];

interface ListeningFriend {
  id: string;
  name: string;
  avatar: string;
  track: { title: string; thumbnail: string; communityFallback?: string };
}

interface VoyoLiveCardProps {
  onSwitchToVOYO?: () => void;
}

export const VoyoLiveCard = ({ onSwitchToVOYO }: VoyoLiveCardProps = {}) => {
  const setShouldOpenNowPlaying = usePlayerStore(s => s.setShouldOpenNowPlaying);
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  // Bucket progress to "thresholds passed" — instead of subscribing to
  // raw progress (4Hz updates → 4 re-renders/sec on an always-mounted
  // hero card → cascading layout reflow into Vibes + Stations below),
  // subscribe to the count of thresholds we've already crossed. The
  // selector returns an integer 0-4, only changes 4 times per song.
  // The dissolve effect below reads this instead of `progress`.
  const passedThresholdsCount = usePlayerStore(s =>
    NEXT_SHOW_AT.filter(t => s.progress >= t).length
  );
  const queue = usePlayerStore(s => s.queue);
  const { dashId, isLoggedIn } = useAuth();

  // Real data
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsActivity, setFriendsActivity] = useState<FriendActivity[]>([]);
  const [friendsListening, setFriendsListening] = useState<ListeningFriend[]>(MOCK_FRIENDS_LISTENING);

  // Animation state
  const [gradientIndex, setGradientIndex] = useState(0);
  const [prevGradientIndex, setPrevGradientIndex] = useState(0);
  const [centerIndex, setCenterIndex] = useState(0);
  const [prevCenterIndex, setPrevCenterIndex] = useState<number | null>(null);
  const [rotation, setRotation] = useState(0);
  const [friendIndex, setFriendIndex] = useState(0);
  const [prevFriendIndex, setPrevFriendIndex] = useState<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const centerFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const friendFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Card mode: community (purple) ↔ dissolve (black flash) ↔ next (orange)
  type CardMode = 'community' | 'dissolve' | 'next';
  const [cardMode, setCardMode] = useState<CardMode>('community');
  const modeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dissolveTargetRef = useRef<'next' | 'community'>('next');
  const shownCountRef = useRef(0);
  // Double-tap detection: single tap = open player, double tap = toggle Next Up
  const lastTapRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Entry+exit transition duration for every cycling element. Picked
  // long enough to read as "absorbed" (not a hard swap), short enough
  // that the swap still feels responsive. Blur softens the transition
  // so the swap reads as atmospheric, not a page-element change.
  const ABSORB_MS = 700;

  // Fetch real friends data
  useEffect(() => {
    if (!dashId || !isLoggedIn) return;

    // (audit-2 P1-RT-5) cancelled flag so stale fetches don't write
    // into state after the effect re-runs (currentTrack flip, sign-out
    // mid-fetch). Without this, an in-flight Promise resolved against
    // the OLD dashId closure and overrode whatever the new effect
    // just wrote — visible glitch on every track change + auth flash
    // (friend ring repopulating after sign-out).
    let cancelled = false;

    const loadData = async () => {
      try {
        const [friendsList, activity] = await Promise.all([
          friendsAPI.getFriends(dashId),
          activityAPI.getFriendsActivity(dashId),
        ]);
        if (cancelled) return;
        setFriends(friendsList);
        setFriendsActivity(activity);

        // Build real friends listening list
        const realList: ListeningFriend[] = [];

        // Add yourself if playing
        if (currentTrack) {
          realList.push({
            id: 'me',
            name: 'You',
            avatar: DEFAULT_AVATARS[0],
            track: { title: currentTrack.title, thumbnail: currentTrack.coverUrl },
          });
        }

        // Add friends who are listening
        activity.filter(a => a.now_playing).forEach(a => {
          const friend = friendsList.find(f => f.dash_id === a.dash_id);
          realList.push({
            id: a.dash_id,
            name: friend?.name || `V${a.dash_id.slice(0, 4)}`,
            avatar: friend?.avatar || DEFAULT_AVATARS[realList.length % DEFAULT_AVATARS.length],
            track: { title: a.now_playing!.title, thumbnail: a.now_playing!.thumbnail },
          });
        });

        // Only update if we have real data, otherwise keep mock
        if (realList.length > 0) {
          setFriendsListening(realList);
        }
      } catch (err) {
        devWarn('[VoyoLiveCard] Failed to load:', err);
      }
    };

    loadData();
    // Visibility-gate: skip BG ticks (browser throttles intervals on
    // hidden tabs anyway, and no point firing while the user can't see).
    const interval = setInterval(() => {
      if (document.hidden) return;
      loadData();
    }, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [dashId, isLoggedIn, currentTrack]);

  // Build avatars from real friends or defaults
  const avatars = friends.length > 0
    ? friends.slice(0, 5).map(f => f.avatar || DEFAULT_AVATARS[0])
    : DEFAULT_AVATARS;

  // Slow gradient cycle (10 seconds). Previous gradient stays rendered
  // during a 2s crossfade; the new gradient layer mounts with a
  // fade-in animation so colours dissolve into each other instead of
  // hard-swapping.
  useEffect(() => {
    const interval = setInterval(() => {
      setPrevGradientIndex(gradientIndex);
      setGradientIndex(prev => (prev + 1) % GRADIENT_COLORS.length);
    }, 10000);
    return () => clearInterval(interval);
  }, [gradientIndex]);

  // Cycle center avatar — keep the outgoing index rendered for ABSORB_MS
  // so we can crossfade old→new instead of hard-swapping.
  useEffect(() => {
    if (avatars.length === 0) return;
    const interval = setInterval(() => {
      setCenterIndex(prev => {
        setPrevCenterIndex(prev);
        if (centerFadeTimerRef.current) clearTimeout(centerFadeTimerRef.current);
        centerFadeTimerRef.current = setTimeout(() => setPrevCenterIndex(null), ABSORB_MS);
        return (prev + 1) % avatars.length;
      });
    }, 4000);
    return () => {
      clearInterval(interval);
      if (centerFadeTimerRef.current) clearTimeout(centerFadeTimerRef.current);
    };
  }, [avatars.length]);

  // Cycle friends listening — same crossfade treatment. The friend pair
  // (thumbnail + mini avatar) is the "notification" the user reads
  // most — swapping them absorbed (blur + fade) kills the flicker.
  useEffect(() => {
    if (friendsListening.length === 0) return;
    const interval = setInterval(() => {
      setFriendIndex(prev => {
        setPrevFriendIndex(prev);
        if (friendFadeTimerRef.current) clearTimeout(friendFadeTimerRef.current);
        friendFadeTimerRef.current = setTimeout(() => setPrevFriendIndex(null), ABSORB_MS);
        return (prev + 1) % friendsListening.length;
      });
    }, 5000);
    return () => {
      clearInterval(interval);
      if (friendFadeTimerRef.current) clearTimeout(friendFadeTimerRef.current);
    };
  }, [friendsListening.length]);

  // Smooth rotation animation — pauses when tab is hidden (battery fix).
  // Throttled to ~20fps (50ms) instead of 60fps — 3x cheaper on the home feed,
  // imperceptible for slow ring rotation.
  // users don't perceive the difference below 30fps for slow rotations.
  useEffect(() => {
    let lastTime = performance.now();
    let lastSetState = lastTime;
    const speed = 0.02;
    const STATE_THROTTLE_MS = 50; // ~20fps

    const animate = (currentTime: number) => {
      if (document.hidden) {
        animationRef.current = window.setTimeout(() => {
          animationRef.current = requestAnimationFrame(animate);
        }, 1000) as unknown as number;
        return;
      }
      const delta = currentTime - lastTime;
      lastTime = currentTime;
      if (currentTime - lastSetState >= STATE_THROTTLE_MS) {
        lastSetState = currentTime;
        setRotation(prev => (prev + delta * speed) % 360);
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    const handleVisibility = () => {
      if (!document.hidden) {
        lastTime = performance.now(); // Reset to avoid huge delta jump
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    };
  }, []);

  // Track change → reset counter + dissolve back to community
  useEffect(() => {
    shownCountRef.current = 0;
    if (cardMode !== 'community') {
      dissolveTargetRef.current = 'community';
      setCardMode('dissolve');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  // Dissolve timer — 350ms bridge between modes
  useEffect(() => {
    if (cardMode !== 'dissolve') return;
    modeTimerRef.current = setTimeout(() => setCardMode(dissolveTargetRef.current), 350);
    return () => { if (modeTimerRef.current) clearTimeout(modeTimerRef.current); };
  }, [cardMode]);

  // Next Up auto-dismiss — back to community after 7s
  useEffect(() => {
    if (cardMode !== 'next') return;
    modeTimerRef.current = setTimeout(() => {
      dissolveTargetRef.current = 'community';
      setCardMode('dissolve');
    }, 7000);
    return () => { if (modeTimerRef.current) clearTimeout(modeTimerRef.current); };
  }, [cardMode]);

  // Progress-based Next Up trigger — 1 at start (7%), 3 more spaced through track
  useEffect(() => {
    if (!currentTrack || !isPlaying || queue.length === 0) return;
    if (cardMode !== 'community') return;
    // Only fire when a NEW threshold crosses (count incremented since last
    // shown). Skips the dead spam between thresholds — was firing 4×/sec.
    if (passedThresholdsCount > shownCountRef.current) {
      shownCountRef.current = passedThresholdsCount;
      dissolveTargetRef.current = 'next';
      setCardMode('dissolve');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passedThresholdsCount, cardMode, currentTrack?.id, isPlaying, queue.length]);

  const orbitAvatars = avatars.filter((_, i) => i !== centerIndex).slice(0, 3);
  const radius = 32;
  const currentGradient = GRADIENT_COLORS[gradientIndex];
  const prevGradient = GRADIENT_COLORS[prevGradientIndex];

  // Next track from queue
  const nextTrack = queue.length > 0 ? queue[0] : null;

  // Live count — real friends currently playing; 0 = show nothing
  const liveCount = friendsActivity.filter(a => a.now_playing).length;

  // Get current 2 friends to display (+ outgoing pair for crossfade).
  const friend1 = friendsListening[friendIndex % friendsListening.length];
  const friend2 = friendsListening[(friendIndex + 1) % friendsListening.length];
  const prevFriend1 = prevFriendIndex != null ? friendsListening[prevFriendIndex % friendsListening.length] : null;
  const prevFriend2 = prevFriendIndex != null ? friendsListening[(prevFriendIndex + 1) % friendsListening.length] : null;

  const getAvatarPosition = (index: number) => {
    const baseAngle = rotation + (index * 100);
    const rad = (baseAngle * Math.PI) / 180;
    return { x: Math.cos(rad) * radius, y: Math.sin(rad) * radius };
  };

  return (
    <div className="mb-6">
      {/* Header — single dot-anchored surface that owns both the
          static "Oyé We Live" anchor AND the rolling tales (Now
          playing, Next up, Trending, milestones). Replaces the
          legacy LiveStatusBar that lived above this card. */}
      <AnchoredTaleHeader />

      {/* Card */}
      <div className="px-4">
        <div
          className="relative overflow-hidden rounded-2xl cursor-pointer"
          onClick={() => {
            const now = Date.now();
            const gap = now - lastTapRef.current;
            if (gap < 280 && gap > 0) {
              // Double tap — toggle Next Up manually
              if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
              lastTapRef.current = 0;
              if (cardMode === 'next') {
                dissolveTargetRef.current = 'community';
                setCardMode('dissolve');
              } else if (cardMode === 'community') {
                dissolveTargetRef.current = 'next';
                setCardMode('dissolve');
              }
              return;
            }
            lastTapRef.current = now;
            // Single tap — delayed so double-tap can intercept
            tapTimerRef.current = setTimeout(() => {
              if (onSwitchToVOYO) onSwitchToVOYO();
              else if (currentTrack) setShouldOpenNowPlaying(true);
            }, 280);
          }}
        >
          {/* Background gradient — previous layer sits behind, solid. */}
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(135deg, ${prevGradient.from}, ${prevGradient.via}, ${prevGradient.to})` }}
          />

          {/* Background gradient — current layer mounts with a 1.6s
              fade-in on every index change, dissolving over the prev.
              Keyed on gradientIndex so React remounts → animation fires. */}
          <div
            key={`grad-${gradientIndex}`}
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, ${currentGradient.from}, ${currentGradient.via}, ${currentGradient.to})`,
              animation: 'voyo-absorb-in 1600ms cubic-bezier(0.4, 0, 0.2, 1) forwards',
            }}
          />

          {/* Shimmer */}
          <div
            className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/12 to-transparent"
          />

          {/* Mode overlay — dissolve: translucent black flash; next: orange */}
          {cardMode !== 'community' && (
            <div
              key={`mode-overlay-${cardMode}`}
              className="absolute inset-0 z-10"
              style={{
                background: cardMode === 'dissolve'
                  ? 'rgba(0,0,0,0.72)'
                  : 'linear-gradient(135deg, #C2410C 0%, #EA580C 45%, #F97316 100%)',
                animation: 'voyo-absorb-in 350ms cubic-bezier(0.4,0,0.2,1) forwards',
              }}
            />
          )}

          <div className="relative flex items-center gap-5 p-4 z-20">
            {/* Avatar orbit system */}
            <div className="relative w-20 h-20 flex-shrink-0">
              {/* Pulsing ring */}
              <div
                className="absolute inset-0 rounded-full border-2 border-white/20"
              />

              {/* Center avatar — dual-rendered for absorbed swap. The
                  outgoing avatar fades out + blurs while the incoming
                  avatar fades in + unblurs, both in the same slot. */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                <div className="relative w-11 h-11">
                  {prevCenterIndex != null && (
                    <div
                      key={`center-prev-${prevCenterIndex}`}
                      className="absolute inset-0 rounded-full overflow-hidden border-[3px] border-white shadow-xl"
                      style={{ animation: `voyo-absorb-out ${ABSORB_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards` }}
                    >
                      <img src={avatars[prevCenterIndex]} decoding="async" alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div
                    key={`center-cur-${centerIndex}`}
                    className="absolute inset-0 rounded-full overflow-hidden border-[3px] border-white shadow-xl"
                    style={{ animation: `voyo-absorb-in ${ABSORB_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards` }}
                  >
                    <img src={avatars[centerIndex]} decoding="async" alt="" className="w-full h-full object-cover" />
                  </div>
                </div>

                <div
                  className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white"
                />
              </div>

              {/* Orbiting avatars */}
              {orbitAvatars.map((avatar, i) => {
                const pos = getAvatarPosition(i);
                return (
                  <div
                    key={`orbit-${i}`}
                    className="absolute w-7 h-7 rounded-full overflow-hidden border-2 border-white/90 shadow-lg"
                    style={{
                      left: '50%',
                      top: '50%',
                      transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
                      zIndex: 10 - i,
                      }}
                  >
                    <img src={avatar} decoding="async" alt="" className="w-full h-full object-cover" />
                  </div>
                );
              })}
            </div>

            {/* Copy — switches between community label and next track info */}
            <div className="flex-1 min-w-0">
              {cardMode === 'next' && nextTrack ? (
                <div key="copy-next" style={{ animation: 'voyo-absorb-in 400ms cubic-bezier(0.4,0,0.2,1) forwards' }}>
                  <p className="text-[9px] font-black tracking-widest uppercase mb-0.5" style={{ color: 'rgba(212,160,83,0.95)' }}>Next Up</p>
                  <p className="text-white font-bold text-sm leading-tight truncate">{nextTrack.track.title}</p>
                  <p className="text-white/70 text-xs truncate mt-0.5">{nextTrack.track.artist}</p>
                </div>
              ) : (
                <div key="copy-community">
                  <h3 className="text-white leading-tight" style={{ fontWeight: 900, fontSize: '1.2rem', letterSpacing: '-0.02em' }}>Vibing Right Now</h3>
                  {liveCount > 0 && <p className="text-white/65 text-xs mt-0.5">{liveCount} in Voyo</p>}
                </div>
              )}
            </div>

            {/* Right side — community: 2 friend cards + play; next: iframe card */}
            <div className="flex items-center gap-2">
              {cardMode !== 'next' ? (
                <>
                  <div className="flex -space-x-3">
                    <div className="relative w-9 h-9" style={{ zIndex: 10 }}>
                      {prevFriend1 && (
                        <div
                          key={`f1-prev-${prevFriendIndex}`}
                          className="absolute inset-0 rounded-lg overflow-hidden border-2 border-white/50 shadow-lg"
                          style={{ animation: `voyo-absorb-out ${ABSORB_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards` }}
                        >
                          <TrackThumbnail
                            youtubeId={prevFriend1.track.thumbnail}
                            communityUrl={prevFriend1.track.communityFallback}
                            title={prevFriend1.track.title}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border border-white overflow-hidden">
                            <img src={prevFriend1.avatar} decoding="async" alt={prevFriend1.name} className="w-full h-full object-cover" />
                          </div>
                        </div>
                      )}
                      <div
                        key={`f1-cur-${friendIndex}`}
                        className="absolute inset-0 rounded-lg overflow-hidden border-2 border-white/50 shadow-lg"
                        style={{ animation: `voyo-absorb-in ${ABSORB_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards` }}
                      >
                        <TrackThumbnail
                          youtubeId={friend1.track.thumbnail}
                          communityUrl={friend1.track.communityFallback}
                          title={friend1.track.title}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border border-white overflow-hidden">
                          <img src={friend1.avatar} decoding="async" alt={friend1.name} className="w-full h-full object-cover" />
                        </div>
                      </div>
                    </div>

                    <div className="relative w-9 h-9" style={{ zIndex: 9 }}>
                      {prevFriend2 && (
                        <div
                          key={`f2-prev-${prevFriendIndex}`}
                          className="absolute inset-0 rounded-lg overflow-hidden border-2 border-white/50 shadow-lg"
                          style={{ animation: `voyo-absorb-out ${ABSORB_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards` }}
                        >
                          <TrackThumbnail
                            youtubeId={prevFriend2.track.thumbnail}
                            communityUrl={prevFriend2.track.communityFallback}
                            title={prevFriend2.track.title}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border border-white overflow-hidden">
                            <img src={prevFriend2.avatar} decoding="async" alt={prevFriend2.name} className="w-full h-full object-cover" />
                          </div>
                        </div>
                      )}
                      <div
                        key={`f2-cur-${friendIndex}`}
                        className="absolute inset-0 rounded-lg overflow-hidden border-2 border-white/50 shadow-lg"
                        style={{ animation: `voyo-absorb-in ${ABSORB_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards` }}
                      >
                        <TrackThumbnail
                          youtubeId={friend2.track.thumbnail}
                          communityUrl={friend2.track.communityFallback}
                          title={friend2.track.title}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border border-white overflow-hidden">
                          <img src={friend2.avatar} decoding="async" alt={friend2.name} className="w-full h-full object-cover" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Plush velvet play button */}
                  <div
                    className="relative w-11 h-11 rounded-full flex items-center justify-center overflow-hidden voyo-plush-play"
                    style={{
                      background: 'radial-gradient(circle at 32% 24%, rgba(167,139,250,0.55) 0%, rgba(88,28,135,1) 42%, rgba(39,15,69,1) 100%)',
                      boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.22), inset 0 -3px 6px rgba(0,0,0,0.45), 0 6px 14px rgba(0,0,0,0.45), 0 0 0 1px rgba(167,139,250,0.18), 0 0 18px rgba(139,92,246,0.22)',
                    }}
                  >
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background: 'linear-gradient(110deg, transparent 30%, rgba(196,181,253,0.18) 48%, transparent 66%)',
                        backgroundSize: '220% 100%',
                        animation: 'voyo-plush-shimmer 4.2s ease-in-out infinite',
                      }}
                    />
                    <Play className="w-5 h-5 text-white relative z-10" fill="white" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.45))' }} />
                  </div>
                </>
              ) : (
                /* Next Up — orange mode: single iframe card */
                <div
                  key="next-card"
                  className="relative rounded-xl overflow-hidden flex-shrink-0"
                  style={{
                    width: 78, height: 78,
                    boxShadow: '0 0 0 2px rgba(212,160,83,0.85), 0 0 18px rgba(212,160,83,0.4), 0 6px 20px rgba(0,0,0,0.5)',
                    animation: 'voyo-absorb-in 400ms cubic-bezier(0.4,0,0.2,1) forwards',
                  }}
                >
                  {nextTrack ? (
                    <iframe
                      src={`https://www.youtube.com/embed/${nextTrack.track.trackId}?autoplay=1&mute=1&controls=0&playsinline=1&loop=1&playlist=${nextTrack.track.trackId}&start=30`}
                      allow="autoplay; encrypted-media"
                      allowFullScreen={false}
                      className="w-full h-full border-0 scale-[1.4] pointer-events-none"
                      title={nextTrack.track.title}
                    />
                  ) : currentTrack ? (
                    <TrackThumbnail
                      youtubeId={currentTrack.trackId}
                      communityUrl={currentTrack.coverUrl}
                      title={currentTrack.title}
                      className="w-full h-full object-cover"
                    />
                  ) : null}
                  {/* Gold channel label */}
                  <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-center" style={{ background: 'rgba(0,0,0,0.55)' }}>
                    <p className="text-[8px] font-black tracking-widest" style={{ color: 'rgba(212,160,83,0.9)' }}>NEXT UP</p>
                  </div>
                </div>
              )}
              <style>{`
                @keyframes voyo-plush-shimmer {
                  0%, 100% { background-position: 200% 0; }
                  50%      { background-position: -100% 0; }
                }
                @media (prefers-reduced-motion: reduce) {
                  .voyo-plush-play div[aria-hidden],
                  .voyo-plush-play > div:first-child { animation: none !important; }
                }
              `}</style>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const SignInPrompt = VoyoLiveCard;
export default VoyoLiveCard;
export type { VoyoLiveCardProps };
