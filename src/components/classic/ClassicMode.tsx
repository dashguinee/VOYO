/**
 * VOYO Music - Classic Mode Container
 * The standard app experience: Home Feed, Library, Now Playing
 *
 * Bottom Navigation:
 * - Home (Home Feed)
 * - VOYO (Switch to VOYO Mode)
 * - Library
 */

import { useState, useEffect, useCallback } from 'react';
import { Home, Library as LibraryIcon, MessageCircle } from 'lucide-react';
import { HomeFeed } from './HomeFeed';
import { Library } from './Library';
import { MiniPlayer } from './MiniPlayer';
import { Dahub } from '../dahub/Dahub';
import { Safe } from '../ui/Safe';
import { APP_CODES } from '../../lib/dahub/dahub-api';
import { NowPlaying } from './NowPlaying';
import { usePlayerStore } from '../../store/playerStore';
import { app } from '../../services/oyo';
import { Track } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useOyoInvocation } from '../../oyo-ui/useOyoInvocation';
import { useTabHistory } from '../../hooks/useTabHistory';

type ClassicTab = 'home' | 'hub' | 'library';

interface ClassicModeProps {
  onSwitchToVOYO: (tab?: 'music' | 'feed' | 'upload' | 'dahub') => void;
  onSearch: () => void;
}


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
  // MessageCircle (chat bubble) for DaHub — Users (silhouettes) reads as "profile".
  const leftTab = activeTab === 'home' ? 'hub' : 'home';
  const LeftIcon = activeTab === 'home' ? MessageCircle : Home;
  const isLeftActive = (activeTab === 'home' && leftTab === 'hub') ? false : activeTab === leftTab;

  // RIGHT: Always Library (highlighted when active)
  const isLibraryActive = activeTab === 'library';

  // OYO long-press summon — surface depends on which classic tab we're on
  const oyoSurface =
    activeTab === 'hub' ? 'dahub' : activeTab === 'library' ? 'home' : 'home';
  const { bindLongPress } = useOyoInvocation();
  const oyoBindings = bindLongPress(oyoSurface);

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
          aria-label={leftTab === 'hub' ? 'DAHUB' : 'Home'}
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

        {/* CENTER: VOYO ORB — consistent with VoyoBottomNav.
            Long-press (600ms) summons OYO via the bindLongPress() handlers. */}
        <button
          className="relative flex items-center justify-center active:scale-95 transition-transform duration-75"
          aria-label="VOYO — tap to switch mode, long-press to summon OYO"
          onClick={onVOYOClick}
          onPointerDown={oyoBindings.onPointerDown}
          onPointerUp={oyoBindings.onPointerUp}
          onPointerLeave={oyoBindings.onPointerLeave}
          onPointerCancel={oyoBindings.onPointerCancel}
          onClickCapture={oyoBindings.onClickCapture}
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
          aria-label="Library"
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
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-2xl font-bold text-white">
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
  const { dashId, displayName } = useAuth();
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const shouldOpenNowPlaying = usePlayerStore(s => s.shouldOpenNowPlaying);
  const setShouldOpenNowPlaying = usePlayerStore(s => s.setShouldOpenNowPlaying);

  // Tab-level back-gesture: back from Library/Hub returns to Home instead
  // of exiting the app. Mirrors PortraitVOYO's voyoActiveTab pattern.
  useTabHistory(activeTab, setActiveTab, 'classic-tab');

  // shouldOpenNowPlaying is set by the search overlay
  useEffect(() => {
    if (shouldOpenNowPlaying) {
      setShowNowPlaying(true);
      setShouldOpenNowPlaying(false); // Clear the flag
    }
  }, [shouldOpenNowPlaying, setShouldOpenNowPlaying]);

  // Section-aware track play handler - CONSOLIDATED
  // Communal sections (Top 10, African Vibes, Trending) → open full player
  // Personal sections (Continue Listening, Made For You) → mini player only
  //
  // useCallback keeps the ref stable across ClassicMode renders so that
  // HomeFeed's downstream useCallback wrappers + the memoised TrackCard /
  // WideTrackCard / ClassicsDiskCard / ArtistCard / AfricanVibesVideoCard
  // children don't all invalidate on every parent state tick.
  const handleTrackClick = useCallback((track: Track, options?: { openFull?: boolean }) => {
    if (options?.openFull) {
      setShowNowPlaying(true);
    }
    app.playTrack(track, 'feed');
  }, [setShowNowPlaying]);

  return (
    <div
      className="relative h-full bg-[#0a0a0c]"
      style={{ paddingInline: 'var(--safe-x)' }}
    >
      {/* Tab Content */}
      
        <div
          key={activeTab}
          className="h-full"
        >
          {activeTab === 'home' && (
            <Safe name="HomeFeed" fallback={
              <div className="h-full flex items-center justify-center px-6 text-center">
                <div className="max-w-xs">
                  <p className="text-white/70 text-sm mb-2">Home couldn't load right now.</p>
                  <p className="text-white/40 text-xs">Try the Library tab or pull to refresh.</p>
                </div>
              </div>
            }>
              <HomeFeed
                onTrackPlay={handleTrackClick}
                onSearch={onSearch}
                onNavVisibilityChange={setNavVisible}
                onSwitchToVOYO={onSwitchToVOYO}
              />
            </Safe>
          )}
          {activeTab === 'hub' && (
            dashId ? (
              <Dahub
                userId={dashId}
                userName={displayName || 'DASH Citizen'}
                coreId={dashId}
                appContext={APP_CODES.COMMAND_CENTER}
                onClose={() => setActiveTab('home')}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center px-8 text-center bg-[#0a0a0f]">
                <div className="w-20 h-20 rounded-full bg-purple-500/10 flex items-center justify-center mb-5">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-2xl">👋</div>
                </div>
                <h2 className="text-white text-xl font-bold mb-2">Sign in to DaHub</h2>
                <p className="text-white/50 text-sm mb-6 max-w-xs">Connect with friends, share notes, and chat across the DASH ecosystem.</p>
                <button
                  onClick={() => window.open(`https://hub.dasuperhub.com?returnUrl=${window.location.origin}&app=V`, '_blank', 'noopener')}
                  className="px-6 py-3 rounded-full bg-gradient-to-r from-purple-500 to-violet-600 text-white font-semibold text-sm shadow-lg shadow-purple-500/30 active:scale-95 transition-transform"
                >
                  Sign in with DASH ID
                </button>
                <button
                  onClick={() => setActiveTab('home')}
                  className="mt-4 text-white/40 text-sm active:scale-95 transition-transform"
                >
                  Back to home
                </button>
              </div>
            )
          )}
          {activeTab === 'library' && (
            <Library
              onTrackClick={handleTrackClick}
              onDiscoMode={() => onSwitchToVOYO()}
            />
          )}
        </div>
      

      {/* Mini Player - Double tap to open full player */}

        {currentTrack && !showNowPlaying && (
          <MiniPlayer onOpenFull={() => setShowNowPlaying(true)} />
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
      

      {/* Full Now Playing — double-tap on its inline MiniPlayer chrome
          goes one layer deeper to VOYO Portrait. */}
      <NowPlaying
        isOpen={showNowPlaying}
        onClose={() => setShowNowPlaying(false)}
        onSwitchToVoyo={() => onSwitchToVOYO()}
      />
    </div>
  );
};

export default ClassicMode;
