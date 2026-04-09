/**
 * VOYO Music - Classic Mode Container
 * The standard app experience: Home Feed, Library, Now Playing
 *
 * Bottom Navigation:
 * - Home (Home Feed)
 * - VOYO (Switch to VOYO Mode)
 * - Library
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Home, Radio, Library as LibraryIcon, Users, Zap, Plus, Shuffle, Repeat, Repeat1 } from 'lucide-react';
import { HomeFeed } from './HomeFeed';
import { Library } from './Library';
import { Hub } from './Hub';
import { NowPlaying } from './NowPlaying';
import { usePlayerStore } from '../../store/playerStore';
import { getYouTubeThumbnail } from '../../data/tracks';
import { SmartImage } from '../ui/SmartImage';
import { Track } from '../../types';
import { PlaylistModal } from '../playlist/PlaylistModal';
import { useReactionStore } from '../../store/reactionStore';
import { useAuth } from '../../hooks/useAuth';

type ClassicTab = 'home' | 'hub' | 'library';

interface ClassicModeProps {
  onSwitchToVOYO: (tab?: 'music' | 'feed' | 'upload' | 'dahub') => void;
  onSearch: () => void;
}

// Mini Player (shown at bottom when a track is playing)
// Single tap = floating bubble controls, Double tap = full player, Swipe = next/prev
// VOYO = Music Experience App, not just a player!
const MiniPlayer = ({ onVOYOClick, onOpenFull }: { onVOYOClick: () => void; onOpenFull: () => void }) => {
  // Battery fix: fine-grained selectors — progress updates every second
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const togglePlay = usePlayerStore(s => s.togglePlay);
  const progress = usePlayerStore(s => s.progress);
  const nextTrack = usePlayerStore(s => s.nextTrack);
  const prevTrack = usePlayerStore(s => s.prevTrack);
  const shuffleMode = usePlayerStore(s => s.shuffleMode);
  const repeatMode = usePlayerStore(s => s.repeatMode);
  const toggleShuffle = usePlayerStore(s => s.toggleShuffle);
  const cycleRepeat = usePlayerStore(s => s.cycleRepeat);
  const { createReaction } = useReactionStore();
  const { dashId } = useAuth();
  const [shouldScroll, setShouldScroll] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const [showBubbles, setShowBubbles] = useState(false);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const lastTapRef = useRef<number>(0);

  // Double-tap detection for opening full player
  const handleTap = useCallback(() => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300; // ms

    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      // Double tap → open full player
      onOpenFull();
      lastTapRef.current = 0; // Reset
    } else {
      // Single tap → toggle bubbles (with delay to check for double)
      lastTapRef.current = now;
      setTimeout(() => {
        if (Date.now() - lastTapRef.current >= DOUBLE_TAP_DELAY) {
          setShowBubbles(prev => !prev);
        }
      }, DOUBLE_TAP_DELAY);
    }
  }, [onOpenFull]);

  // Handle OYE reaction
  const handleOye = useCallback(() => {
    if (!currentTrack) return;
    createReaction({
      username: dashId || 'anonymous',
      trackId: currentTrack.trackId || currentTrack.id,
      trackTitle: currentTrack.title,
      trackArtist: currentTrack.artist,
      trackThumbnail: currentTrack.coverUrl,
      category: 'afro-heat',
      emoji: '⚡',
      reactionType: 'oye',
    });
  }, [currentTrack, dashId, createReaction]);

  // Check if title needs scrolling (longer than container)
  useEffect(() => {
    if (titleRef.current) {
      setShouldScroll(titleRef.current.scrollWidth > titleRef.current.clientWidth);
    }
  }, [currentTrack?.title]);

  // Handle swipe gestures
  const handleDragEnd = useCallback((event: any, info: { offset: { x: number; y: number } }) => {
    const threshold = 80;
    if (info.offset.x < -threshold) {
      // Swipe left = next track
      setSwipeDirection('left');
      nextTrack();
      setTimeout(() => setSwipeDirection(null), 300);
    } else if (info.offset.x > threshold) {
      // Swipe right = previous track
      setSwipeDirection('right');
      prevTrack();
      setTimeout(() => setSwipeDirection(null), 300);
    }
  }, [nextTrack, prevTrack]);

  // Auto-hide bubbles after 3 seconds
  useEffect(() => {
    if (showBubbles) {
      const timer = setTimeout(() => setShowBubbles(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showBubbles]);

  if (!currentTrack) return null;

  return (
    <div
      className="absolute bottom-24 left-4 right-4 z-40"
    >
      {/* Floating Bubble Controls - appear on tap */}
      
        {showBubbles && (
          <div
            className="absolute -top-16 left-1/2 -translate-x-1/2 flex items-center gap-4 z-50"
          >
            {/* Shuffle Bubble - exits after VOYO */}
            <button
              className={`w-12 h-12 rounded-full backdrop-blur-xl flex items-center justify-center shadow-lg ${
                shuffleMode
                  ? 'bg-purple-500/80 border-2 border-purple-400'
                  : 'bg-[#1c1c22] border border-[#28282f]'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                toggleShuffle();
              }}
            >
              <Shuffle className={`w-5 h-5 ${shuffleMode ? 'text-white' : 'text-white/70'}`} />
            </button>

            {/* Repeat/Loop Bubble - exits after VOYO */}
            <button
              className={`w-12 h-12 rounded-full backdrop-blur-xl flex items-center justify-center shadow-lg ${
                repeatMode !== 'off'
                  ? 'bg-purple-500/80 border-2 border-purple-400'
                  : 'bg-[#1c1c22] border border-[#28282f]'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                cycleRepeat();
              }}
            >
              {repeatMode === 'one' ? (
                <Repeat1 className="w-5 h-5 text-white" />
              ) : (
                <Repeat className={`w-5 h-5 ${repeatMode === 'all' ? 'text-white' : 'text-white/70'}`} />
              )}
              {repeatMode !== 'off' && (
                <div
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-purple-400 text-[8px] font-bold text-white flex items-center justify-center"
                >
                  {repeatMode === 'one' ? '1' : '∞'}
                </div>
              )}
            </button>

            {/* VOYO Player Bubble - Video Experience - disappears first so user notices */}
            <button
              className="w-12 h-12 rounded-full backdrop-blur-xl flex items-center justify-center shadow-lg bg-gradient-to-br from-purple-500/80 to-violet-600/80 border-2 border-purple-400"
              onClick={(e) => {
                e.stopPropagation();
                onVOYOClick();
              }}
            >
              <Radio className="w-5 h-5 text-white" />
            </button>
          </div>
        )}
      

      <div
        className="w-full flex items-center gap-2.5 p-2 pr-3 rounded-2xl border backdrop-blur-xl shadow-2xl relative overflow-hidden cursor-pointer"
        style={{
          background: 'rgba(28, 28, 35, 0.65)',
          borderColor: 'rgba(139, 92, 246, 0.12)',
        }}
        onClick={handleTap}
      >
        {/* Wave Progress Bar - VOYO gradient style */}
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10 overflow-hidden rounded-full">
          <div
            className="h-full relative"
            style={{ width: `${progress}%` }}
          >
            {/* VOYO sunset gradient fill (purple → orange) */}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, #8b5cf6 0%, #a855f7 40%, #f97316 100%)' }} />
            {/* Glowing edge effect */}
            <div
              className="absolute right-0 top-0 bottom-0 w-4"
              style={{ background: 'linear-gradient(to left, rgba(249,115,22,0.6), transparent)' }}
            />
          </div>
        </div>

        {/* Thumbnail - SmartImage with self-healing */}
        <div className="relative w-12 h-12 rounded-xl overflow-hidden flex-shrink-0">
          <SmartImage
            src={getYouTubeThumbnail(currentTrack.trackId, 'medium')}
            alt={currentTrack.title}
            className="w-full h-full object-cover"
            trackId={currentTrack.trackId}
            artist={currentTrack.artist}
            title={currentTrack.title}
          />
        </div>

        {/* Info with scrolling title */}
        <div className="flex-1 min-w-0 text-left overflow-hidden">
          <div className="overflow-hidden">
            <p
              ref={titleRef}
              className={`text-white font-medium text-sm whitespace-nowrap ${shouldScroll ? 'animate-marquee' : 'truncate'}`}
              style={shouldScroll ? {
                animation: 'marquee 8s linear infinite',
              } : {}}
            >
              {currentTrack.title}
              {shouldScroll && <span className="mx-8">{currentTrack.title}</span>}
            </p>
          </div>
          <p className="text-white/50 text-xs truncate">{currentTrack.artist}</p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-shrink-0" style={{ marginRight: '4px' }}>
          {/* Add to playlist */}
          <button
            className="rounded-full bg-white/10 flex items-center justify-center"
            style={{ width: '30px', height: '30px' }}
            onClick={(e) => {
              e.stopPropagation();
              setShowPlaylistModal(true);
            }}
          >
            <Plus className="w-3.5 h-3.5 text-white" />
          </button>

          {/* OYE Button — sunset gradient (orange → yellow) */}
          <button
            className="w-8 h-8 rounded-full flex items-center justify-center"
            onClick={(e) => {
              e.stopPropagation();
              handleOye();
            }}
            style={{
              background: 'linear-gradient(135deg, #f97316, #fbbf24)',
              boxShadow: '0 2px 8px rgba(249, 115, 22, 0.4)',
            }}
          >
            <Zap className="w-4 h-4 text-white" style={{ fill: 'white' }} />
          </button>

          {/* Play/Pause */}
          <button
            className="w-10 h-10 rounded-full bg-white flex items-center justify-center"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
          >
            {isPlaying ? (
              <div className="flex gap-1">
                <div className="w-1 h-4 bg-black rounded-full" />
                <div className="w-1 h-4 bg-black rounded-full" />
              </div>
            ) : (
              <div className="w-0 h-0 border-l-[10px] border-l-black border-y-[6px] border-y-transparent ml-1" />
            )}
          </button>
        </div>
      </div>

      {/* Marquee animation styles */}
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>

      {/* Playlist Modal */}
      {currentTrack && (
        <PlaylistModal
          isOpen={showPlaylistModal}
          onClose={() => setShowPlaylistModal(false)}
          trackId={currentTrack.trackId || currentTrack.id}
          trackTitle={currentTrack.title}
        />
      )}
    </div>
  );
};

// Bottom Navigation — Tivi+ Signature Pattern (Classic Mode)
// Glass bar, one accent color, tap feedback, no labels
const BottomNav = ({
  activeTab,
  onTabChange,
  onVOYOClick
}: {
  activeTab: ClassicTab;
  onTabChange: (tab: ClassicTab) => void;
  onVOYOClick: () => void;
}) => {
  // LEFT: DAHUB when on Home, otherwise Home
  const leftTab = activeTab === 'home' ? 'hub' : 'home';
  const LeftIcon = activeTab === 'home' ? Users : Home;
  const isLeftActive = (activeTab === 'home' && leftTab === 'hub') ? false : activeTab === leftTab;

  // RIGHT: Always Library (highlighted when active)
  const isLibraryActive = activeTab === 'library';

  return (
    <nav
      className="absolute bottom-0 left-0 right-0 z-30 px-3 pt-2 pointer-events-none"
      style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
    >
      <div
        className="pointer-events-auto max-w-md mx-auto h-[62px] rounded-2xl flex items-center justify-around px-2"
        style={{
          background: 'rgba(10, 10, 15, 0.65)',
          backdropFilter: 'blur(16px) saturate(150%)',
          WebkitBackdropFilter: 'blur(16px) saturate(150%)',
          border: '1px solid rgba(139, 92, 246, 0.08)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.5), 0 0 20px rgba(139,92,246,0.04)',
        }}
      >
        {/* LEFT: DAHUB (when on Home) or Home (when elsewhere) */}
        <button
          className="relative flex items-center justify-center flex-1 h-full active:scale-95 transition-transform duration-75"
          onClick={() => onTabChange(leftTab)}
        >
          <LeftIcon
            style={{
              width: 20,
              height: 20,
              color: isLeftActive ? '#8b5cf6' : 'rgba(255, 255, 255, 0.4)',
              strokeWidth: isLeftActive ? 2.2 : 1.8,
              transition: 'color 0.15s ease',
            }}
          />
        </button>

        {/* CENTER: VOYO ORB — consistent with VoyoBottomNav */}
        <button
          className="relative flex items-center justify-center active:scale-95 transition-transform duration-75"
          onClick={onVOYOClick}
          style={{ flex: '0 0 auto' }}
        >
          <div
            className="relative w-14 h-14 rounded-2xl flex items-center justify-center overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 50%, #6d28d9 100%)',
              boxShadow: '0 0 20px rgba(139, 92, 246, 0.35), 0 4px 16px rgba(0,0,0,0.4)',
            }}
          >
            <span className="font-black text-sm text-white tracking-tight">VOYO</span>
          </div>
        </button>

        {/* RIGHT: Always Library */}
        <button
          className="relative flex items-center justify-center flex-1 h-full active:scale-95 transition-transform duration-75"
          onClick={() => onTabChange('library')}
        >
          <LibraryIcon
            style={{
              width: 20,
              height: 20,
              color: isLibraryActive ? '#8b5cf6' : 'rgba(255, 255, 255, 0.4)',
              strokeWidth: isLibraryActive ? 2.2 : 1.8,
              transition: 'color 0.15s ease',
            }}
          />
        </button>
      </div>
    </nav>
  );
};

// Settings/Profile Screen
const SettingsScreen = () => {
  return (
    <div className="flex flex-col h-full px-4 py-4">
      <h1 className="text-2xl font-bold text-white mb-6">Profile</h1>

      {/* Profile Header */}
      <div className="flex items-center gap-4 p-4 rounded-2xl bg-[#1c1c22] border border-[#28282f] mb-6">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-2xl font-bold text-white">
          D
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Dash</h2>
          <p className="text-white/50 text-sm">Premium Member</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Songs', value: '142' },
          { label: 'Playlists', value: '8' },
          { label: 'OYÉ Given', value: '1.2K' },
        ].map((stat) => (
          <div key={stat.label} className="p-4 rounded-xl bg-[#1c1c22] border border-[#28282f] text-center">
            <p className="text-xl font-bold text-white">{stat.value}</p>
            <p className="text-white/50 text-xs">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Settings List */}
      <div className="space-y-2">
        {[
          { label: 'Audio Quality', value: 'High' },
          { label: 'Download Quality', value: 'Very High' },
          { label: 'Storage', value: '2.4 GB used' },
          { label: 'Theme', value: 'Dark' },
          { label: 'Language', value: 'English' },
        ].map((item) => (
          <button
            key={item.label}
            className="w-full flex items-center justify-between p-4 rounded-xl bg-[#1c1c22] border border-[#28282f] hover:bg-[#28282f] transition-colors"
          >
            <span className="text-white">{item.label}</span>
            <span className="text-white/50 text-sm">{item.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export const ClassicMode = ({ onSwitchToVOYO, onSearch }: ClassicModeProps) => {
  const [activeTab, setActiveTab] = useState<ClassicTab>('home');
  const [showNowPlaying, setShowNowPlaying] = useState(false);
  const [navVisible, setNavVisible] = useState(true);
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const shouldOpenNowPlaying = usePlayerStore(s => s.shouldOpenNowPlaying);
  const setShouldOpenNowPlaying = usePlayerStore(s => s.setShouldOpenNowPlaying);

  // FIX A4: Listen for shouldOpenNowPlaying flag (set by search overlay)
  useEffect(() => {
    if (shouldOpenNowPlaying) {
      setShowNowPlaying(true);
      setShouldOpenNowPlaying(false); // Clear the flag
    }
  }, [shouldOpenNowPlaying, setShouldOpenNowPlaying]);

  // Section-aware track play handler - CONSOLIDATED
  // Communal sections (Top 10, African Vibes, Trending) → open full player
  // Personal sections (Continue Listening, Made For You) → mini player only
  const handleTrackClick = (track: Track, options?: { openFull?: boolean }) => {
    // Open full player for communal/discovery sections
    if (options?.openFull) {
      setShowNowPlaying(true);
    }

    // CONSOLIDATED: One atomic call - no delays, no fragmentation
    usePlayerStore.getState().playTrack(track);
  };

  const handleArtistClick = (artist: { name: string; tracks: Track[] }) => {
    // Switch to library with artist filter
    setActiveTab('library');
  };

  return (
    <div className="relative h-full bg-[#0a0a0c]">
      {/* Tab Content */}
      
        <div
          key={activeTab}
          className="h-full"
        >
          {activeTab === 'home' && (
            <HomeFeed
              onTrackPlay={handleTrackClick}
              onSearch={onSearch}
              onDahub={() => setActiveTab('hub')}
              onNavVisibilityChange={setNavVisible}
              onSwitchToVOYO={onSwitchToVOYO}
            />
          )}
          {activeTab === 'hub' && (
            <Hub
              onSwitchToVOYO={onSwitchToVOYO}
              onHome={() => setActiveTab('home')}
              onVoyoFeed={() => onSwitchToVOYO('feed')}
              onLibrary={() => setActiveTab('library')}
            />
          )}
          {activeTab === 'library' && (
            <Library onTrackClick={handleTrackClick} />
          )}
        </div>
      

      {/* Mini Player - Double tap to open full player */}
      
        {currentTrack && !showNowPlaying && (
          <MiniPlayer onVOYOClick={onSwitchToVOYO} onOpenFull={() => setShowNowPlaying(true)} />
        )}
      

      {/* Bottom Navigation - hides during immersive sections and when Hub is shown (Hub has its own nav) */}
      
        {navVisible && activeTab !== 'hub' && (
          <div
          >
            <BottomNav
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onVOYOClick={onSwitchToVOYO}
            />
          </div>
        )}
      

      {/* Full Now Playing */}
      <NowPlaying
        isOpen={showNowPlaying}
        onClose={() => setShowNowPlaying(false)}
      />
    </div>
  );
};

export default ClassicMode;
