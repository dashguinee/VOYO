/**
 * VOYO Live Card
 * For the People, by The People
 *
 * Central avatar + 3 overlapping orbiting avatars + dynamic gradients
 * Shows friends currently listening on VOYO
 */

import { useState, useEffect, useRef } from 'react';
import { Play } from 'lucide-react';
import { usePlayerStore } from '../../store/playerStore';
import { useAuth } from '../../hooks/useAuth';
import { friendsAPI, activityAPI, type Friend, type FriendActivity, APP_CODES } from '../dahub';
import { devWarn } from '../../utils/logger';

// Default avatars for fallback (diverse, West Africa vibes)
const DEFAULT_AVATARS = [
  'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=100&h=100&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1539701938214-0d9736e1c16b?w=100&h=100&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1523824921871-d6f1a15151f1?w=100&h=100&fit=crop&crop=face',
];

// Mock friends listening (fallback)
const MOCK_FRIENDS_LISTENING = [
  { id: '1', name: 'Aziz', avatar: DEFAULT_AVATARS[1], track: { title: 'Last Last', thumbnail: 'https://i.ytimg.com/vi/421w1j87fEM/hqdefault.jpg' } },
  { id: '2', name: 'Kenza', avatar: DEFAULT_AVATARS[2], track: { title: 'Essence', thumbnail: 'https://i.ytimg.com/vi/jipQpjUA_o8/hqdefault.jpg' } },
  { id: '3', name: 'Mamadou', avatar: DEFAULT_AVATARS[3], track: { title: 'Calm Down', thumbnail: 'https://i.ytimg.com/vi/WcIcVapfqXw/hqdefault.jpg' } },
  { id: '4', name: 'Fatou', avatar: DEFAULT_AVATARS[4], track: { title: 'Peru', thumbnail: 'https://i.ytimg.com/vi/mCfPHnO3EB4/hqdefault.jpg' } },
];

// Gradient colors
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
  track: { title: string; thumbnail: string };
}

interface VoyoLiveCardProps {
  onSwitchToVOYO?: () => void;
}

export const VoyoLiveCard = ({ onSwitchToVOYO }: VoyoLiveCardProps = {}) => {
  const setShouldOpenNowPlaying = usePlayerStore(s => s.setShouldOpenNowPlaying);
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const { isLoggedIn, dashId } = useAuth();

  // Real data
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsActivity, setFriendsActivity] = useState<FriendActivity[]>([]);
  const [friendsListening, setFriendsListening] = useState<ListeningFriend[]>(MOCK_FRIENDS_LISTENING);

  // Animation state
  const [gradientIndex, setGradientIndex] = useState(0);
  const [prevGradientIndex, setPrevGradientIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [centerIndex, setCenterIndex] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [friendIndex, setFriendIndex] = useState(0);
  const animationRef = useRef<number | null>(null);

  // Fetch real friends data
  useEffect(() => {
    if (!dashId || !isLoggedIn) return;

    const loadData = async () => {
      try {
        const [friendsList, activity] = await Promise.all([
          friendsAPI.getFriends(dashId!),
          activityAPI.getFriendsActivity(dashId!, APP_CODES.VOYO),
        ]);
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

        // Add friends who are listening (have activity)
        activity.filter(a => a.activity).forEach(a => {
          const friend = friendsList.find(f => f.dash_id === a.dash_id);
          if (friend && a.activity_data?.track) {
            realList.push({
              id: a.dash_id,
              name: friend.name || `V${a.dash_id.slice(0, 4)}`,
              avatar: friend.avatar || DEFAULT_AVATARS[realList.length % DEFAULT_AVATARS.length],
              track: {
                title: a.activity_data.track.title || 'Unknown Track',
                thumbnail: a.activity_data.track.thumbnail || DEFAULT_AVATARS[0]
              },
            });
          }
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
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [dashId, isLoggedIn, currentTrack]);

  // Build avatars from real friends or defaults
  const avatars = friends.length > 0
    ? friends.slice(0, 5).map(f => f.avatar || DEFAULT_AVATARS[0])
    : DEFAULT_AVATARS;

  // Slow gradient cycle (10 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      setPrevGradientIndex(gradientIndex);
      setIsTransitioning(true);
      setGradientIndex(prev => (prev + 1) % GRADIENT_COLORS.length);
      setTimeout(() => setIsTransitioning(false), 2000);
    }, 10000);
    return () => clearInterval(interval);
  }, [gradientIndex]);

  // Cycle center avatar
  useEffect(() => {
    const interval = setInterval(() => {
      setCenterIndex(prev => (prev + 1) % avatars.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [avatars.length]);

  // Cycle friends listening
  useEffect(() => {
    const interval = setInterval(() => {
      setFriendIndex(prev => (prev + 1) % friendsListening.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [friendsListening.length]);

  // Smooth rotation animation — pauses when tab is hidden (battery fix)
  useEffect(() => {
    let lastTime = performance.now();
    const speed = 0.02;

    const animate = (currentTime: number) => {
      if (document.hidden) {
        // When hidden, throttle to 1fps instead of 60fps
        animationRef.current = window.setTimeout(() => {
          animationRef.current = requestAnimationFrame(animate);
        }, 1000) as unknown as number;
        return;
      }
      const delta = currentTime - lastTime;
      lastTime = currentTime;
      setRotation(prev => (prev + delta * speed) % 360);
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
    };
  }, []);

  const orbitAvatars = avatars.filter((_, i) => i !== centerIndex).slice(0, 3);
  const radius = 32;
  const currentGradient = GRADIENT_COLORS[gradientIndex];
  const prevGradient = GRADIENT_COLORS[prevGradientIndex];

  // Get current 2 friends to display
  const friend1 = friendsListening[friendIndex % friendsListening.length];
  const friend2 = friendsListening[(friendIndex + 1) % friendsListening.length];

  const getAvatarPosition = (index: number) => {
    const baseAngle = rotation + (index * 100);
    const rad = (baseAngle * Math.PI) / 180;
    return { x: Math.cos(rad) * radius, y: Math.sin(rad) * radius };
  };

  return (
    <div className="mb-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3 px-4">
        <div
          className="w-2 h-2 rounded-full bg-green-500"
        />
        <h2 className="text-white/90 font-bold text-lg">Oye! We Live</h2>
      </div>

      {/* Card */}
      <div className="px-4">
        <div
          className="relative overflow-hidden rounded-2xl cursor-pointer"
          onClick={() => {
            // Switch to VOYO Player if callback provided, otherwise open NowPlaying panel
            if (onSwitchToVOYO) {
              onSwitchToVOYO();
            } else if (currentTrack) {
              setShouldOpenNowPlaying(true);
            }
            }}
        >
          {/* Background gradient - previous */}
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(135deg, ${prevGradient.from}, ${prevGradient.via}, ${prevGradient.to})` }}
          />

          {/* Background gradient - current */}
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(135deg, ${currentGradient.from}, ${currentGradient.via}, ${currentGradient.to})` }}
          />

          {/* Shimmer */}
          <div
            className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/12 to-transparent"
          />

          <div className="relative flex items-center gap-5 p-4">
            {/* Avatar orbit system */}
            <div className="relative w-20 h-20 flex-shrink-0">
              {/* Pulsing ring */}
              <div
                className="absolute inset-0 rounded-full border-2 border-white/20"
              />

              {/* Center avatar */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                
                  <div
                    key={centerIndex}
                    className="w-11 h-11 rounded-full overflow-hidden border-[3px] border-white shadow-xl"
                  >
                    <img src={avatars[centerIndex]} alt="" className="w-full h-full object-cover" />
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
                    <img src={avatar} alt="" className="w-full h-full object-cover" />
                  </div>
                );
              })}
            </div>

            {/* Copy */}
            <div className="flex-1 min-w-0">
              <h3 className="text-white font-bold text-lg leading-tight">Vibes on Vibes</h3>
              <p className="text-white/70 text-xs">For the People, by The People</p>
            </div>

            {/* Mini friend cards + Play button */}
            <div className="flex items-center gap-2">
              <div className="flex -space-x-3">
                
                  <div
                    key={`friend-${friend1.id}-${friendIndex}`}
                    className="relative w-9 h-9 rounded-lg overflow-hidden border-2 border-white/50 shadow-lg"
                    style={{ zIndex: 10 }}
                  >
                    <img src={friend1.track.thumbnail} alt="" className="w-full h-full object-cover" />
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border border-white overflow-hidden">
                      <img src={friend1.avatar} alt={friend1.name} className="w-full h-full object-cover" />
                    </div>
                  </div>

                  <div
                    key={`friend-${friend2.id}-${friendIndex}`}
                    className="relative w-9 h-9 rounded-lg overflow-hidden border-2 border-white/50 shadow-lg"
                    style={{ zIndex: 9 }}
                  >
                    <img src={friend2.track.thumbnail} alt="" className="w-full h-full object-cover" />
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border border-white overflow-hidden">
                      <img src={friend2.avatar} alt={friend2.name} className="w-full h-full object-cover" />
                    </div>
                  </div>
                
              </div>

              <div
                className="w-11 h-11 rounded-full bg-black/30 backdrop-blur flex items-center justify-center"
              >
                <Play className="w-5 h-5 text-white" fill="white" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VoyoLiveCard;
export type { VoyoLiveCardProps };
