/**
 * VOYO Music - Portrait VOYO Mode
 * Tab Orchestrator: MUSIC | FEED | CREATE | DAHUB
 *
 * This is the main container that switches between:
 * - VoyoPortraitPlayer (Music experience)
 * - VoyoMoments (4-directional moments feed)
 * - CreatorUpload (Content creation)
 * - Hub (DAHUB social hub)
 */

import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { X, Send } from 'lucide-react';
import { usePlayerStore } from '../../store/playerStore';
import { DJMode, Track } from '../../types';

// Lightweight — always loaded
import { VoyoBottomNav } from './navigation/VoyoBottomNav';
import type { MomentTrackInfo } from './feed/VoyoMoments';

// Heavy components — lazy loaded for code splitting
const VoyoMoments = lazy(() => import('./feed/VoyoMoments').then(m => ({ default: m.VoyoMoments })));
const VoyoPortraitPlayer = lazy(() => import('./VoyoPortraitPlayer').then(m => ({ default: m.VoyoPortraitPlayer })));
// OFFICIAL DaHub from Hub.tsx (Classic Mode) — single source of truth, Command Center wired, has own nav
const Hub = lazy(() => import('../classic/Hub').then(m => ({ default: m.Hub })));
const ArtistPage = lazy(() => import('./ArtistPage').then(m => ({ default: m.ArtistPage })));

// Quick DJ Prompts
const DJ_PROMPTS = [
  { id: 'more-like-this', text: 'More like this' },
  { id: 'something-different', text: 'Something different' },
  { id: 'more-energy', text: 'More energy' },
  { id: 'chill-vibes', text: 'Chill vibes' },
];

// DJ Response Messages
const DJ_RESPONSES: Record<string, string[]> = {
  'more-like-this': ["Got you fam!", "Adding similar vibes..."],
  'something-different': ["Say less!", "Switching it up..."],
  'more-energy': ["AYEEE!", "Turning UP!"],
  'chill-vibes': ["Cooling it down...", "Smooth vibes only"],
  'default': ["I hear you!", "Say less, fam!", "OYE!"],
};

// ============================================
// DJ TEXT INPUT COMPONENT
// Can be triggered from landscape mode (hold/double-tap center button)
// ============================================
interface DJTextInputProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
}

export const DJTextInput = ({ isOpen, onClose, onSubmit }: DJTextInputProps) => {
  const [inputText, setInputText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSubmit = () => {
    if (inputText.trim()) {
      onSubmit(inputText.trim());
      setInputText('');
    }
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end animate-[voyo-fade-in_0.3s_ease]"
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

          <div
            className="relative z-10 bg-gradient-to-t from-[#0a0a0f] via-[#1a1a2e] to-transparent px-4 pb-8 pt-12 animate-[voyo-slide-up_0.3s_ease]"
          >
            <button
              className="absolute top-4 right-4 p-2 rounded-full bg-white/10"
              onClick={onClose}
            >
              <X className="w-5 h-5 text-white/70" />
            </button>

            <div className="text-center mb-4">
              <p className="text-white/50 text-sm">Talk to OYO</p>
              <h3 className="text-white font-bold text-lg">Wazzguan?</h3>
            </div>

            <div className="flex flex-wrap justify-center gap-2 mb-4">
              {DJ_PROMPTS.map((prompt) => (
                <button
                  key={prompt.id}
                  className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/70 text-sm"
                  onClick={() => { onSubmit(prompt.text); setInputText(''); }}
                >
                  {prompt.text}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="Or type your request..."
                className="flex-1 px-4 py-3 rounded-full bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500/50"
              />
              <button
                className="p-3 rounded-full bg-gradient-to-r from-purple-500 to-[#D4A053]"
                onClick={handleSubmit}
              >
                <Send className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ============================================
// MAIN EXPORT - PORTRAIT VOYO MODE (ORCHESTRATOR)
// Bottom Nav: HOME | VOYO | DAHUB
// ============================================
interface PortraitVOYOProps {
  onSearch?: () => void;
  onDahub?: () => void;
  onHome?: () => void;
}

export const PortraitVOYO = ({ onSearch, onDahub, onHome }: PortraitVOYOProps) => {
  // Fine-grained selectors — avoid re-render on every progress tick.
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const togglePlay = usePlayerStore(s => s.togglePlay);
  const refreshRecommendations = usePlayerStore(s => s.refreshRecommendations);
  const setVolume = usePlayerStore(s => s.setVolume);
  const volume = usePlayerStore(s => s.volume);
  const voyoActiveTab = usePlayerStore(s => s.voyoActiveTab);
  const setVoyoTab = usePlayerStore(s => s.setVoyoTab);
  const playTrack = usePlayerStore(s => s.playTrack);

  const [djMode, setDjMode] = useState<DJMode>('idle');
  const [djResponse, setDjResponse] = useState<string | null>(null);
  const [isTextInputOpen, setIsTextInputOpen] = useState(false);
  const [artistPageName, setArtistPageName] = useState<string | null>(null);
  const originalVolumeRef = useRef(volume);

  // Fade music when DJ is active
  useEffect(() => {
    if (djMode !== 'idle') {
      // Store current volume before ducking (even if 0)
      originalVolumeRef.current = volume;
      setVolume(Math.max(10, volume * 0.3));
    } else if (djMode === 'idle') {
      // FIX: Always restore original volume, even if it was 0 (muted)
      setVolume(originalVolumeRef.current);
    }
  }, [djMode, volume, setVolume]);

  // Handle OYEE - Voice listen mode
  const handleListenMode = () => {
    if (djMode === 'listening') {
      setDjMode('responding');
      setDjResponse("Back to the vibes!");
      setTimeout(() => {
        setDjMode('idle');
        setDjResponse(null);
        if (!isPlaying) togglePlay();
      }, 1500);
    } else {
      setDjMode('listening');
      if (isPlaying) togglePlay();
      setTimeout(() => setDjResponse("Wazzguan?"), 800);
      setTimeout(() => setDjResponse(null), 2500);
    }
  };

  // Handle Wazzguan - Text input mode
  const handleTextMode = () => {
    setIsTextInputOpen(true);
    setDjMode('listening');
    if (isPlaying) togglePlay();
  };

  // Handle DJ command submission
  const handleDJCommand = (command: string) => {
    setIsTextInputOpen(false);
    setDjMode('thinking');

    const commandLower = command.toLowerCase();
    let responseKey = 'default';

    if (commandLower.includes('like this') || commandLower.includes('similar')) {
      responseKey = 'more-like-this';
    } else if (commandLower.includes('different') || commandLower.includes('change')) {
      responseKey = 'something-different';
    } else if (commandLower.includes('energy') || commandLower.includes('hype')) {
      responseKey = 'more-energy';
    } else if (commandLower.includes('chill') || commandLower.includes('relax')) {
      responseKey = 'chill-vibes';
    }

    setTimeout(() => {
      setDjMode('responding');
      const responses = DJ_RESPONSES[responseKey] || DJ_RESPONSES.default;
      setDjResponse(responses[Math.floor(Math.random() * responses.length)]);
      refreshRecommendations();

      setTimeout(() => {
        setDjMode('idle');
        setDjResponse(null);
        if (!isPlaying) togglePlay();
      }, 2000);
    }, 600);
  };

  const handleCloseTextInput = () => {
    setIsTextInputOpen(false);
    if (djMode === 'listening') setDjMode('idle');
  };

  return (
    <>
      <div className="flex flex-col h-full bg-black overflow-hidden relative">
        {/* Shared purple animation - flows behind EVERYTHING (feed + nav) */}
        <div className="absolute inset-0 pointer-events-none z-0">
          <div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[200%] h-[60%]"
            style={{
              background: 'radial-gradient(ellipse at center bottom, rgba(168,85,247,0.15) 0%, rgba(139,92,246,0.08) 30%, transparent 70%)',
            }}
          />
        </div>

        {/* LAYER 1: MUSIC MODE - Main Player */}
        <div
          className="absolute inset-0 z-0 pb-20 transition-all duration-400"
          style={{
            transform: voyoActiveTab === 'music' ? 'scale(1)' : 'scale(0.95)',
            opacity: voyoActiveTab === 'music' ? 1 : 0,
            filter: voyoActiveTab === 'music' ? 'blur(0px)' : 'blur(10px)',
            pointerEvents: voyoActiveTab === 'music' ? 'auto' : 'none',
          }}
        >
          <Suspense fallback={<div className="h-full bg-[#0a0a0c]" />}>
            <VoyoPortraitPlayer
              onVoyoFeed={() => setVoyoTab('feed')}
              djMode={djMode === 'listening' || djMode === 'responding'}
              onToggleDJMode={handleListenMode}
              onSearch={onSearch}
            />
          </Suspense>
        </div>

        {/* LAYER 2: FEED MODE (Slide-in Overlay) */}
        <div
          className="absolute inset-0 z-10 transition-all duration-500"
          style={{
            transform: voyoActiveTab === 'feed' ? 'translateX(0)' : 'translateX(100%)',
            opacity: voyoActiveTab === 'feed' ? 1 : 0,
            pointerEvents: voyoActiveTab === 'feed' ? 'auto' : 'none',
          }}
        >
          <Suspense fallback={<div className="h-full bg-[#0a0a0c]" />}>
          <VoyoMoments
            onPlayFullTrack={(trackInfo: MomentTrackInfo) => {
              const track: Track = {
                id: trackInfo.id,
                trackId: trackInfo.id,
                title: trackInfo.title,
                artist: trackInfo.artist,
                coverUrl: `https://i.ytimg.com/vi/${trackInfo.id}/hqdefault.jpg`,
                duration: 0,
                tags: [],
                oyeScore: 0,
                createdAt: new Date().toISOString(),
              };
              playTrack(track);
              setVoyoTab('music');
            }}
            onArtistTap={(name) => setArtistPageName(name)}
          />
          </Suspense>
        </div>

        {/* LAYER 3: CREATOR MODE — hidden until backend ready */}

        {/* LAYER 4: DAHUB MODE (Slide-in from Left) */}
        <div
          className="absolute inset-0 z-20 bg-[#050507] pb-20 overflow-y-auto transition-all duration-500"
          style={{
            transform: voyoActiveTab === 'dahub' ? 'translateX(0)' : 'translateX(-100%)',
            opacity: voyoActiveTab === 'dahub' ? 1 : 0,
            pointerEvents: voyoActiveTab === 'dahub' ? 'auto' : 'none',
          }}
        >
          <Suspense fallback={<div className="h-full bg-[#0a0a0c]" />}>
            <Hub
              onHome={onHome}
              onSwitchToVOYO={() => setVoyoTab('music')}
              onVoyoFeed={() => setVoyoTab('feed')}
            />
          </Suspense>
        </div>

        {/* LAYER 5: BOTTOM NAVIGATION (Hidden when Hub is shown - Hub has its own nav) */}
        {voyoActiveTab !== 'dahub' && (
          <VoyoBottomNav onDahub={onDahub} onHome={onHome} />
        )}

      </div>

      {/* DJ Text Input Overlay */}
      <DJTextInput
        isOpen={isTextInputOpen}
        onClose={handleCloseTextInput}
        onSubmit={handleDJCommand}
      />

      {/* Artist Page Overlay */}
      {artistPageName && (
        <Suspense fallback={<div className="fixed inset-0 bg-[#0a0a0c] z-50" />}>
        <ArtistPage
          artistName={artistPageName}
          onClose={() => setArtistPageName(null)}
          onPlayTrack={(trackId, title, artist) => {
            const track: Track = {
              id: trackId,
              trackId,
              title,
              artist,
              coverUrl: `https://i.ytimg.com/vi/${trackId}/hqdefault.jpg`,
              duration: 0,
              tags: [],
              oyeScore: 0,
              createdAt: new Date().toISOString(),
            };
            playTrack(track);
          }}
        />
        </Suspense>
      )}

    </>
  );
};

export default PortraitVOYO;
