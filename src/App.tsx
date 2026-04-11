/**
 * VOYO Music - Main Application
 * The complete music listening experience - YOUR PERSONAL DJ
 *
 * Modes:
 * 1. Classic Mode - Home Feed, Library, Now Playing (Spotify-style)
 * 2. Portrait VOYO - Main player with DJ interaction
 * 3. Landscape VOYO - Wide layout (detected by orientation)
 * 4. Video Mode - Full immersion with floating reactions
 */

import { useState, useEffect, useRef, useCallback, lazy, Suspense, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { User, Search } from 'lucide-react';
import { usePlayerStore } from './store/playerStore';
import { getYouTubeThumbnail } from './data/tracks';
import { setupMobileAudioUnlock } from './utils/mobileAudioUnlock';
import { AnimatedBackground, BackgroundPicker, BackgroundType, ReactionCanvas } from './components/backgrounds/AnimatedBackgrounds';
import { AudioPlayer } from './components/AudioPlayer';
import { YouTubeIframe } from './components/YouTubeIframe';
import { InstallButton } from './components/ui/InstallButton';
import { OfflineIndicator } from './components/ui/OfflineIndicator';
import { VoyoSplash } from './components/voyo/VoyoSplash';
import { usePullToRefresh } from './hooks/usePullToRefresh';

// Lazy-loaded mode components (code splitting — only load active mode)
const PortraitVOYO = lazy(() => import('./components/voyo/PortraitVOYO'));
const LandscapeVOYO = lazy(() => import('./components/voyo/LandscapeVOYO'));
const VideoMode = lazy(() => import('./components/voyo/VideoMode'));
const ClassicMode = lazy(() => import('./components/classic/ClassicMode'));
const SearchOverlay = lazy(() => import('./components/search/SearchOverlayV2'));
const ArtistPage = lazy(() => import('./components/voyo/ArtistPage'));
const UniversePanel = lazy(() => import('./components/universe/UniversePanel').then(m => ({ default: m.UniversePanel })));
// OYO ambient AI invocation overlay — Phase 2. Lazy so the mercury SVG +
// chat layer don't bloat the initial bundle. Only loads the first time
// the user long-presses the VOYO orb to summon OYO.
const OyoInvocation = lazy(() => import('./oyo-ui/OyoInvocation').then(m => ({ default: m.OyoInvocation })));
import { useReactionStore } from './store/reactionStore';
import { devLog, devWarn } from './utils/logger';
import { AuthProvider } from './providers/AuthProvider';

// DEBUG: Load intent engine verification tools (available in browser console)
import './utils/debugIntent';

// BRAIN: Initialize the intelligent DJ system
// Brain subsystem is lazy-loaded inside the boot useEffect via dynamic import.
// This pulls the ~110 KB app-brain chunk out of the initial bundle — Brain
// isn't on the playback hot path yet (the playback flow reads from
// playerStore.hotTracks/discoverTracks fed by databaseDiscovery, not from
// sessionExecutor.getHotBelt()), so deferring it to requestIdleCallback
// reclaims initial-load time with zero UX regression.

// SCOUTS: Hungry agents that feed knowledge to the Brain.
// The scout patrol useEffect is currently disabled (see commented block below
// near line 1083 — 64 YouTube API calls per session was too much). The
// startScoutPatrol/getScoutStats imports were dead but kept the entire
// /scouts/ tree in the eager bundle. When the patrol re-enables, these become
// dynamic imports inside the useEffect — same pattern as the Brain lazy-load.
//
// DATABASE FEEDER side-effect import (window.feedDatabase debug global) also
// removed for the same reason; re-add via dynamic import behind a debug flag
// when needed.

// TRACK POOL: Start pool maintenance for dynamic track management
import { startPoolMaintenance } from './store/trackPoolStore';
import { bootstrapPool, curateAllSections } from './services/poolCurator';
import { runStartupHeal } from './services/trackVerifier';
import { syncSeedTracks } from './services/centralDJ';
import { TRACKS } from './data/tracks';
import { syncManyToDatabase } from './services/databaseSync';
import { DashAuthBadge } from './lib/dash-auth';
import { useUniverseStore } from './store/universeStore';
import * as voyoApi from './lib/voyo-api';

// ============================================
// ERROR BOUNDARY — catches render crashes, shows fallback instead of white screen
// ============================================
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[VOYO] Render crash caught by ErrorBoundary:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(180deg, #0a0a12 0%, #0a0612 50%, #0a0a0f 100%)',
            color: 'white',
            fontFamily: "'Inter', system-ui, sans-serif",
            padding: 24,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 48,
              fontWeight: 900,
              letterSpacing: '0.05em',
              marginBottom: 12,
              background: 'linear-gradient(135deg, #a78bfa, #8b5cf6)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              color: 'transparent',
            }}
          >
            VOYO
          </div>
          <div style={{ fontSize: 15, opacity: 0.5, marginBottom: 8, fontWeight: 500 }}>
            Something went wrong
          </div>
          <div style={{ fontSize: 12, opacity: 0.25, marginBottom: 32, maxWidth: 280, lineHeight: 1.5 }}>
            The app encountered an unexpected error. Tap below to restart.
          </div>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            style={{
              padding: '14px 40px',
              borderRadius: 999,
              background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
              color: 'white',
              border: 'none',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 0 24px rgba(139, 92, 246, 0.3)',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// App modes
type AppMode = 'classic' | 'voyo' | 'video';

// Detect orientation
const useOrientation = () => {
  const [isLandscape, setIsLandscape] = useState(
    typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false
  );

  useEffect(() => {
    const handleResize = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  return isLandscape;
};

// Dynamic Island - iPhone-style notification pill
interface Notification {
  id: string;
  type: 'music' | 'message' | 'system';
  title: string;
  subtitle: string;
  read?: boolean;
  color?: string; // Custom color for friends
}

const DynamicIsland = () => {
  // Demo notifications - in production from backend
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isFading, setIsFading] = useState(false);
  const [phase, setPhase] = useState<'wave' | 'dark' | 'idle'>('idle');
  const [isReplying, setIsReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isNewNotification, setIsNewNotification] = useState(false); // Wave only for new
  const [showTapFeedback, setShowTapFeedback] = useState(false); // Tap-to-resurface animation
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);

  const currentNotification = notifications[currentIndex];
  const unreadCount = notifications.filter(n => !n.read).length;

  // Expose function to add notifications globally
  useEffect(() => {
    (window as any).pushNotification = (notif: Notification) => {
      setNotifications(prev => {
        const newList = [...prev, notif];
        // Navigate to the new notification (use callback to avoid stale closure)
        setCurrentIndex(newList.length - 1);
        return newList;
      });
      triggerNewNotification(); // Wave for new notifications
    };

    // Demo: Auto-trigger notifications to show the full flow
    const demo1 = setTimeout(() => {
      (window as any).pushNotification({
        id: '1',
        type: 'music',  // Purple dot
        title: 'Burna Boy',
        subtitle: 'Higher just dropped'
      });
    }, 1000);

    // Friend message after 8s (custom blue color)
    const demo2 = setTimeout(() => {
      (window as any).pushNotification({
        id: '2',
        type: 'message',  // Blue dot
        title: 'Aziz',
        subtitle: 'yo come check this out'
      });
    }, 8000);

    // System notification after 15s
    const demo3 = setTimeout(() => {
      (window as any).pushNotification({
        id: '3',
        type: 'system',  // Red dot
        title: 'VOYO',
        subtitle: 'notification system ready'
      });
    }, 15000);

    return () => {
      clearTimeout(demo1);
      clearTimeout(demo2);
      clearTimeout(demo3);
    };
  }, []);

  // NEW NOTIFICATION: wave → dark → fade
  const triggerNewNotification = () => {
    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);

    // Reset everything first, then start wave
    setIsFading(false);
    setIsExpanded(false);
    setIsNewNotification(true);
    setPhase('wave');

    // Small delay to ensure clean state before showing
    requestAnimationFrame(() => {
      setIsVisible(true);
    });

    // Wave (3s) → Dark (3s) → Fade
    phaseTimerRef.current = setTimeout(() => {
      setIsNewNotification(false);
      setPhase('dark');

      phaseTimerRef.current = setTimeout(() => {
        setIsFading(true);
        phaseTimerRef.current = setTimeout(() => {
          setIsVisible(false);
          setPhase('idle');
          setIsFading(false);
        }, 600);
      }, 3000);
    }, 3000);
  };

  // MANUAL RESURFACE: just dark (no wave)
  const triggerManualResurface = () => {
    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);

    setIsVisible(true);
    setIsExpanded(false);
    setIsFading(false);
    setIsNewNotification(false);
    setPhase('dark');

    // Dark (3s) → Fade
    phaseTimerRef.current = setTimeout(() => {
      setIsFading(true);
      phaseTimerRef.current = setTimeout(() => {
        setIsVisible(false);
        setPhase('idle');
        setIsFading(false);
      }, 600);
    }, 3000);
  };

  // When expanded - NO auto-dismiss. User must take action.
  // Only clear any pending fade timers
  useEffect(() => {
    if (isExpanded) {
      // Cancel any auto-fade - expanded stays until user acts
      if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      setIsFading(false);
    }
  }, [isExpanded]);

  // Dismiss current notification
  const dismissCurrent = () => {
    const remaining = notifications.filter((_, i) => i !== currentIndex);
    setNotifications(remaining);

    // Always fade out gracefully
    setIsFading(true);
    setTimeout(() => {
      setIsVisible(false);
      setIsExpanded(false);
      setIsReplying(false);
      setIsFading(false);
      setPhase('idle');

      if (remaining.length > 0) {
        setCurrentIndex(Math.min(currentIndex, remaining.length - 1));
        // Don't auto-show next - user can tap to resurface
      }
    }, 400);
  };

  // Navigate notifications (collapsed: swipe left/right, swipe up to dismiss)
  const handleCollapsedDrag = (_: any, info: { offset: { x: number; y: number } }) => {
    if (info.offset.y < -40) {
      // Swipe up - dismiss
      dismissCurrent();
    } else if (Math.abs(info.offset.x) > 40) {
      // Swipe left/right - navigate (no wave, just change)
      if (info.offset.x > 0 && currentIndex > 0) {
        setCurrentIndex(currentIndex - 1);
      } else if (info.offset.x < 0 && currentIndex < notifications.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
    }
  };

  // Expanded: swipe up to dismiss, left/right to navigate with wave transition
  const [isTransitioning, setIsTransitioning] = useState(false);

  const handleExpandedDrag = (_: any, info: { offset: { x: number; y: number } }) => {
    if (info.offset.y < -50) {
      // Swipe up - dismiss
      dismissCurrent();
    } else if (Math.abs(info.offset.x) > 50 && !isTransitioning) {
      const newIndex = info.offset.x > 0
        ? Math.max(0, currentIndex - 1)
        : Math.min(notifications.length - 1, currentIndex + 1);

      if (newIndex !== currentIndex) {
        // Wave transition between notifications
        setIsTransitioning(true);

        // Wave washes out current
        setTimeout(() => {
          setCurrentIndex(newIndex);
          // Wave washes in new
          setTimeout(() => {
            setIsTransitioning(false);
          }, 300);
        }, 300);
      }
    }
  };

  const handleTap = () => {
    // Cancel any pending fade
    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    setIsFading(false);

    if (!isExpanded) {
      // Collapsed → Expand (stays until user acts)
      setPhase('idle');
      setIsExpanded(true);
    } else {
      // Expanded → Collapse back to dark (with timer)
      setIsExpanded(false);
      setPhase('dark');
      phaseTimerRef.current = setTimeout(() => {
        setIsFading(true);
        setTimeout(() => {
          setIsVisible(false);
          setPhase('idle');
          setIsFading(false);
        }, 600);
      }, 3000);
    }
  };

  // Manual resurface - tap header when notifications exist but not visible
  const handleResurface = () => {
    if (notifications.length > 0 && !isVisible) {
      triggerManualResurface();
    }
  };

  const handleAction = (action: string) => {
    devLog(`Action: ${action} for ${currentNotification?.title}`);

    // Action taken - remove from queue and next wave
    const remaining = notifications.filter((_, i) => i !== currentIndex);
    setNotifications(remaining);

    if (remaining.length > 0) {
      setIsExpanded(false);
      setIsVisible(false);
      setCurrentIndex(Math.min(currentIndex, remaining.length - 1));
      setTimeout(() => triggerManualResurface(), 400);
    } else {
      setIsExpanded(false);
      setIsVisible(false);
      setPhase('idle');
    }
  };

  const handleReplyMode = () => {
    setIsReplying(true);
    // Wave washes in via AnimatePresence, then focus input
    setTimeout(() => {
      replyInputRef.current?.focus();
    }, 500);
  };

  const [isSending, setIsSending] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [waveformLevels, setWaveformLevels] = useState<number[]>([0.3, 0.3, 0.3, 0.3, 0.3]);
  const [transcript, setTranscript] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Setup audio context for waveform
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      analyserRef.current.fftSize = 32;

      // Animate waveform
      const updateWaveform = () => {
        if (analyserRef.current) {
          const data = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(data);
          const levels = Array.from(data.slice(0, 5)).map(v => Math.max(0.2, v / 255));
          setWaveformLevels(levels);
        }
        animationRef.current = requestAnimationFrame(updateWaveform);
      };
      updateWaveform();

      // Setup speech recognition for transcript
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.onresult = (event: any) => {
          const result = Array.from(event.results)
            .map((r: any) => r[0].transcript)
            .join('');
          setTranscript(result);
        };
        recognitionRef.current.start();
      }

      // Setup media recorder
      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.start();

      setIsRecording(true);
    } catch (err) {
      console.error('Mic access denied:', err);
      setIsVoiceMode(false);
      setCountdown(null);
    }
  };

  const stopRecording = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (audioContextRef.current) audioContextRef.current.close();
    if (recognitionRef.current) recognitionRef.current.stop();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    setWaveformLevels([0.3, 0.3, 0.3, 0.3, 0.3]);
  };

  // Cleanup recording resources on unmount (prevents memory leak)
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch {
          // Ignore errors during cleanup
        }
      }
      try {
        if (recognitionRef.current) recognitionRef.current.stop();
      } catch {
        // Recognition may already be stopped
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.stream?.getTracks().forEach(t => t.stop());
        } catch {
          // MediaRecorder may already be stopped
        }
      }
    };
  }, []);

  const handleVoiceTap = () => {
    // Tap on wavy box triggers voice mode
    if (!isVoiceMode && !isRecording && countdown === null) {
      setIsVoiceMode(true);
      setTranscript('');
      setCountdown(3);
      setTimeout(() => setCountdown(2), 1000);
      setTimeout(() => setCountdown(1), 2000);
      setTimeout(() => {
        setCountdown(null);
        startRecording();
      }, 3000);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setReplyText(e.target.value);
    // Typing cancels voice mode
    if (isVoiceMode || isRecording || countdown !== null) {
      stopRecording();
      setIsVoiceMode(false);
      setIsRecording(false);
      setCountdown(null);
    }
  };

  const handleSendReply = () => {
    if (replyText.trim() || isRecording) {
      const replyData = {
        type: isRecording ? 'voice' : 'text',
        content: replyText || '[voice note]',
        transcript: isRecording ? transcript : null, // Include transcript for voice
      };
      devLog(`Reply to ${currentNotification?.title}:`, replyData);

      stopRecording();
      setIsSending(true);

      // Wave carries message away (0.8s recede animation)
      setTimeout(() => {
        setReplyText('');
        setTranscript('');
        setIsReplying(false);
        setIsSending(false);
        setIsVoiceMode(false);
        setIsRecording(false);
        setCountdown(null);

        // Mark as read and move to next
        const remaining = notifications.filter((_, i) => i !== currentIndex);
        setNotifications(remaining);

        if (remaining.length > 0) {
          // Next wave arrives
          setIsExpanded(false);
          setIsVisible(false);
          setCurrentIndex(Math.min(currentIndex, remaining.length - 1));
          setTimeout(() => triggerManualResurface(), 400);
        } else {
          // All done - clean exit
          setIsExpanded(false);
          setIsVisible(false);
          setPhase('idle');
        }
      }, 800);
    }
  };

  // When not visible but has notifications
  // Tap banner → dot appears pulsing → click dot to open → no click = fades
  const fadeTimerForDot = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBannerTap = () => {
    if (!showTapFeedback) {
      // First tap: show the pulsing dot
      setShowTapFeedback(true);
      // Auto-fade after 3 seconds if not clicked
      if (fadeTimerForDot.current) clearTimeout(fadeTimerForDot.current);
      fadeTimerForDot.current = setTimeout(() => {
        setShowTapFeedback(false);
      }, 3000);
    }
  };

  const handleDotClick = () => {
    if (fadeTimerForDot.current) clearTimeout(fadeTimerForDot.current);
    setShowTapFeedback(false);
    handleResurface();
  };

  if (!isVisible && notifications.length > 0) {
    // Two states: no dot visible (tap to show), dot visible (tap dot to open)
    if (!showTapFeedback) {
      // Empty banner - tap anywhere to show dot
      return (
        <div
          className="cursor-pointer flex-1 h-8 flex items-center justify-center"
          onClick={handleBannerTap}
          style={{ minWidth: 120 }}
        />
      );
    } else {
      // Dot visible - tap dot to open notification
      return (
        <div
          className="cursor-pointer flex-1 h-8 flex items-center justify-center"
          style={{ minWidth: 120 }}
          onClick={handleDotClick}
        >
          <div
            className="w-3 h-3 rounded-full"
            style={{
              backgroundColor: notifications[0]?.type === 'music' ? '#a855f7' :
                notifications[0]?.type === 'message' ? '#8b5cf6' : '#ef4444'
            }}
          />
        </div>
      );
    }
  }

  if (!isVisible || notifications.length === 0) return null;

  return (
    <div
      className="z-20"
    >
      
        {!isExpanded ? (
          // COLLAPSED STATE - Wave (larger) → Dark (smaller)
          <div
            key="collapsed"
            className="cursor-pointer"
            onClick={handleTap}
          >
            <div
              className={`relative flex items-center gap-2 backdrop-blur-md border rounded-full overflow-hidden ${
                phase === 'wave' && isNewNotification
                  ? 'border-white/40'
                  : 'bg-black/50 border-white/10'
              }`}
              style={{
                width: phase === 'wave' && isNewNotification ? 190 : 165,
                height: phase === 'wave' && isNewNotification ? 30 : 26,
                paddingLeft: phase === 'wave' && isNewNotification ? 16 : 14,
                paddingRight: phase === 'wave' && isNewNotification ? 16 : 14,
              }}
            >
              {/* LIQUID WAVE - Only for NEW notifications */}
              {phase === 'wave' && isNewNotification && (
                <div
                  className="absolute inset-0 overflow-hidden"
                >
                  {/* Base layer - slow movement */}
                  <div
                    className="absolute inset-0"
                    style={{
                      background: 'linear-gradient(90deg, #7c3aed 0%, #8b5cf6 25%, #a78bfa 50%, #7c3aed 75%, #5b21b6 100%)',
                      backgroundSize: '200% 100%',
                    }}
                  />
                  {/* Middle layer - medium movement */}
                  <div
                    className="absolute inset-0 opacity-60"
                    style={{
                      background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 30%, rgba(139,92,246,0.6) 50%, rgba(255,255,255,0.4) 70%, transparent 100%)',
                      backgroundSize: '150% 100%',
                    }}
                  />
                  {/* Top shimmer - fast highlights */}
                  <div
                    className="absolute inset-0 opacity-40"
                    style={{
                      background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.8) 45%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0.8) 55%, transparent 100%)',
                      backgroundSize: '80% 100%',
                    }}
                  />
                </div>
              )}

              {/* Dot - color based on notification type */}
              <span
                className="relative z-10 w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: (phase === 'wave' && isNewNotification) ? '#fff' :
                    currentNotification?.color ? currentNotification.color :
                    currentNotification?.type === 'music' ? '#a855f7' :
                    currentNotification?.type === 'message' ? '#8b5cf6' :
                    '#ef4444'
                }}
              />

              {/* Preview text */}
              <span className={`relative z-10 text-[10px] truncate lowercase ${
                (phase === 'wave' && isNewNotification) ? 'text-white font-semibold' : 'text-white/70'
              }`}>
                {currentNotification?.subtitle}
              </span>

              {/* Unread indicator */}
              {unreadCount > 1 && (
                <span className={`relative z-10 text-[9px] flex-shrink-0 ${
                  (phase === 'wave' && isNewNotification) ? 'text-white/90' : 'text-white/30'
                }`}>
                  +{unreadCount - 1}
                </span>
              )}
            </div>
          </div>
        ) : (
          // EXPANDED STATE - Larger white pill, smooth entrance
          <div
            key="expanded"
            className="cursor-pointer"
          >
            <div
              className="relative backdrop-blur-md rounded-2xl shadow-xl border overflow-hidden"
              style={{
                width: isSending ? 200 : (isReplying ? 300 : 280),
                opacity: isSending ? 0 : 1,
                backgroundColor: isReplying ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.95)',
                borderColor: isReplying ? 'rgba(168,85,247,0.3)' : 'rgba(255,255,255,0.2)',
              }}
            >
              {/* Wave overlay for transitions & reply mode */}
              
                {(isReplying || isTransitioning) && (
                  <div
                    className="absolute inset-0 overflow-hidden"
                  >
                    {/* Deep water base */}
                    <div
                      className="absolute inset-0"
                      style={{
                        background: 'linear-gradient(90deg, #4c1d95 0%, #7c3aed 25%, #8b5cf6 50%, #a78bfa 75%, #4c1d95 100%)',
                        backgroundSize: '200% 100%',
                      }}
                    />
                    {/* Flowing light */}
                    <div
                      className="absolute inset-0 opacity-50"
                      style={{
                        background: 'linear-gradient(90deg, transparent 0%, rgba(240,171,252,0.5) 30%, rgba(255,255,255,0.4) 50%, rgba(240,171,252,0.5) 70%, transparent 100%)',
                        backgroundSize: '150% 100%',
                      }}
                    />
                    {/* Surface shimmer */}
                    <div
                      className="absolute inset-0 opacity-30"
                      style={{
                        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.9) 48%, rgba(255,255,255,1) 50%, rgba(255,255,255,0.9) 52%, transparent 100%)',
                        backgroundSize: '60% 100%',
                      }}
                    />
                  </div>
                )}
              

              {/* Navigation dots */}
              {notifications.length > 1 && !isReplying && (
                <div className="flex justify-center gap-1 pt-2">
                  {notifications.map((_, i) => (
                    <div
                      key={i}
                      className={`w-1 h-1 rounded-full ${i === currentIndex ? 'bg-black/60' : 'bg-black/20'}`}
                    />
                  ))}
                </div>
              )}

              {/* Content */}
              <div className="relative z-10 p-3">
                {!isReplying ? (
                  // Normal expanded view
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-xs font-semibold text-black truncate">
                        {currentNotification?.title}
                      </p>
                      <p className="text-[10px] text-black/60 truncate">
                        {currentNotification?.subtitle}
                      </p>
                    </div>

                    {currentNotification?.type === 'music' ? (
                      <div className="flex gap-1.5">
                        <button
                          className="px-2.5 py-1 rounded-full bg-black/10 text-[10px] font-medium text-black/70"
                          onClick={(e) => { e.stopPropagation(); handleAction('queue'); }}
                        >
                          +Queue
                        </button>
                        <button
                          className="px-2 py-1 rounded-full bg-black/10 text-[10px] font-medium text-black/70"
                          onClick={(e) => { e.stopPropagation(); handleAction('like'); }}
                        >
                          ♡
                        </button>
                      </div>
                    ) : currentNotification?.type === 'message' ? (
                      <button
                        className="px-2.5 py-1 rounded-full bg-purple-500/20 text-[10px] font-medium text-purple-700"
                        onClick={(e) => { e.stopPropagation(); handleReplyMode(); }}
                      >
                        Reply
                      </button>
                    ) : (
                      <button
                        className="px-2.5 py-1 rounded-full bg-black/10 text-[10px] font-medium text-black/70"
                        onClick={(e) => { e.stopPropagation(); handleAction('view'); }}
                      >
                        View
                      </button>
                    )}
                  </div>
                ) : (
                  // Reply mode - Type or Tap to Speak
                  <div
                    className="space-y-2"
                    style={{ opacity: isSending ? 0 : 1 }}
                    onClick={handleVoiceTap}
                  >
                    <p className="text-[10px] text-white/80 font-medium">→ {currentNotification?.title}</p>

                    {/* Countdown */}
                    {countdown !== null ? (
                      <div
                        className="flex items-center justify-center py-2"
                        key={countdown}
                      >
                        <span className="text-2xl font-bold text-white">{countdown}</span>
                      </div>
                    ) : isRecording ? (
                      /* Recording with waveform */
                      <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1 py-2">
                          {waveformLevels.map((level, i) => (
                            <div
                              key={i}
                              className="w-1 bg-purple-400 rounded-full"
                            />
                          ))}
                        </div>
                        {transcript && (
                          <p className="text-[10px] text-white/50 text-center truncate px-2">{transcript}</p>
                        )}
                        <button
                          className="w-full py-2 rounded-full bg-purple-500 flex items-center justify-center gap-2"
                          onClick={handleSendReply}
                        >
                          <span className="text-white text-xs">Send</span>
                          <span className="text-white text-sm">↑</span>
                        </button>
                      </div>
                    ) : (
                      /* Type or Tap to Speak */
                      <div className="space-y-2">
                        <div className="flex gap-2 items-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            ref={replyInputRef}
                            type="text"
                            value={replyText}
                            onChange={handleInputChange}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendReply()}
                            placeholder="Type..."
                            className="flex-1 px-4 py-2 rounded-full bg-white/10 border-0 text-white text-[12px] placeholder:text-white/40 focus:outline-none"
                            style={{ caretColor: '#f0abfc' }}
                          />
                          {replyText.trim() && (
                            <button
                              className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center"
                              onClick={handleSendReply}
                            >
                              <span className="text-white text-sm">↑</span>
                            </button>
                          )}
                        </div>
                        {!replyText.trim() && (
                          <p className="text-[10px] text-white/40 text-center">Tap to Speak</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Swipe hint */}
              {!isReplying && (
                <div className="pb-2 flex justify-center">
                  <div className="w-8 h-0.5 bg-black/20 rounded-full" />
                </div>
              )}
            </div>
          </div>
        )}
      
    </div>
  );
};

// ── Auto-update button (ported from Tivi+) ──
// Two-tier detection:
//  1. SW message — when a new service worker activates with a fresh cache,
//     it postMessages every tab. main.tsx translates that into the
//     `voyo-update-available` window event we listen for here.
//  2. Polled /version.json — every 2 minutes we cache-bust-fetch the
//     version file. If it differs from the build-time stamp, we know a
//     new build is live even if the SW hasn't updated yet. force=true
//     auto-clears all caches and reloads (no user choice).
function UpdateButton() {
  const [available, setAvailable] = useState(false);
  const [forceUpdate, setForceUpdate] = useState(false);

  useEffect(() => {
    const swHandler = () => setAvailable(true);
    window.addEventListener('voyo-update-available', swHandler);

    let active = true;
    async function checkVersion() {
      try {
        const res = await fetch('/version.json?t=' + Date.now(), {
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.version && data.version !== __APP_VERSION__) {
          if (data.force) {
            setForceUpdate(true);
            if ('caches' in window) {
              const keys = await caches.keys();
              await Promise.all(keys.map(k => caches.delete(k)));
            }
            window.location.reload();
          } else {
            setAvailable(true);
          }
        }
      } catch { /* offline or timeout — skip */ }
    }

    checkVersion();
    const interval = setInterval(() => { if (active) checkVersion(); }, 2 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener('voyo-update-available', swHandler);
    };
  }, []);

  if (forceUpdate) {
    return (
      <div className="fixed inset-0 z-[9999] bg-[#050508] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-lg font-bold text-white mb-2" style={{ fontFamily: "'Outfit', sans-serif" }}>Updating VOYO</h1>
          <div className="w-10 h-[2px] mx-auto rounded-full overflow-hidden bg-white/5">
            <div className="h-full w-full rounded-full" style={{ background: 'rgba(139, 92, 246, 0.5)', animation: 'voyo-loading-bar 1.5s ease-in-out infinite' }} />
          </div>
        </div>
        <style>{`@keyframes voyo-loading-bar { 0%, 100% { transform: translateX(-100%); } 50% { transform: translateX(100%); } }`}</style>
      </div>
    );
  }

  if (!available) return null;

  return (
    <button
      onClick={async () => {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
        window.location.reload();
      }}
      className="fixed bottom-24 right-4 z-[9998] flex items-center gap-2 px-4 py-2.5 rounded-full backdrop-blur-md transition-all duration-300"
      style={{
        background: 'rgba(139, 92, 246, 0.15)',
        border: '1px solid rgba(139, 92, 246, 0.35)',
        boxShadow: '0 10px 30px rgba(139, 92, 246, 0.25)',
        fontFamily: "'Outfit', sans-serif",
      }}
    >
      <span className="w-2 h-2 rounded-full animate-ping" style={{ background: '#a78bfa' }} />
      <span className="text-xs font-semibold tracking-wide" style={{ color: '#a78bfa' }}>Update available</span>
    </button>
  );
}

function App() {
  // Battery fix: fine-grained selectors
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const setVoyoTab = usePlayerStore(s => s.setVoyoTab);
  const [bgError, setBgError] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [artistPageName, setArtistPageName] = useState<string | null>(null);
  // VOYO PLAYER FIRST - Default to player, but remember user preference
  const [appMode, setAppMode] = useState<AppMode>(() => {
    // One-time migration: reset to voyo player as new default (v1.2)
    const migrated = localStorage.getItem('voyo-mode-migrated-v12');
    if (!migrated) {
      localStorage.removeItem('voyo-app-mode');
      localStorage.setItem('voyo-mode-migrated-v12', 'true');
      return 'voyo';
    }
    const saved = localStorage.getItem('voyo-app-mode');
    return (saved === 'classic' || saved === 'voyo' || saved === 'video')
      ? (saved as AppMode)
      : 'voyo';
  });
  const [backgroundType, setBackgroundType] = useState<BackgroundType>('none'); // Clean dark - users discover effects via toggle
  const [isBackgroundPickerOpen, setIsBackgroundPickerOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const isLandscape = useOrientation();

  // SPLASH SCREEN - Show on first load only (per session)
  const [showSplash, setShowSplash] = useState(() => {
    // Check if splash was already shown this session (v3 = fixed design)
    const splashShown = sessionStorage.getItem('voyo-splash-v3');
    return !splashShown;
  });

  const handleSplashComplete = useCallback(() => {
    sessionStorage.setItem('voyo-splash-v3', 'true');
    setShowSplash(false);
  }, []);

  // Pull-to-refresh: pull down at the top of any view to reload the app.
  // Especially useful while iterating on production fixes — the user can
  // grab a new build without hunting for a refresh button.
  const ptr = usePullToRefresh();

  // MOBILE FIX: Setup audio unlock on app mount
  useEffect(() => {
    setupMobileAudioUnlock();
  }, []);

  // DASH AUTH: Handle callback from Command Center (simple, synchronous)
  useEffect(() => {
    const { handleDashCallback } = useUniverseStore.getState();
    const success = handleDashCallback();
    if (success) {
      devLog('[VOYO] DASH sign-in successful!');
      // Trigger re-render for components listening to storage
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'dash_citizen_storage',
      }));
    }
  }, []);

  // VOYO:PLAYTRACK - Listen for track play events from cross-promo sections
  useEffect(() => {
    const handlePlayTrack = async (event: CustomEvent) => {
      const { youtubeId, title, artist, thumbnail } = event.detail;
      if (!youtubeId) return;

      // Create a track object from the event data
      const track = {
        id: `voyo-${youtubeId}`,
        trackId: youtubeId,
        title: title || 'Unknown Track',
        artist: artist || 'Unknown Artist',
        coverUrl: thumbnail || `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
        mood: 'vibe' as const,
        tags: ['cross-promo'],
        oyeScore: 0,
      };

      // Play the track - consolidated playTrack for reliable playback
      devLog('[VOYO] Playing cross-promo track:', title);
      usePlayerStore.getState().playTrack(track as any);
    };

    const listener = (e: Event) => { handlePlayTrack(e as CustomEvent); };
    window.addEventListener('voyo:playTrack', listener);
    return () => {
      window.removeEventListener('voyo:playTrack', listener);
    };
  }, []);

  // NETWORK DETECTION: Detect network quality on app mount
  useEffect(() => {
    const { detectNetworkQuality } = usePlayerStore.getState();
    detectNetworkQuality();
  }, []);

  // BRAIN: Lazy-load the intelligent DJ signal capture once the browser is
  // idle. Defers ~110 KB out of the initial bundle. Cleanup is wired through
  // the closure so unmount-during-load is safe.
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    const scheduleIdle = (cb: () => void): (() => void) => {
      const w = window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      };
      if (typeof w.requestIdleCallback === 'function') {
        const id = w.requestIdleCallback(cb, { timeout: 3000 });
        return () => w.cancelIdleCallback?.(id);
      }
      // Safari etc. — fall back to a 1.5s timeout (after first paint)
      const id = window.setTimeout(cb, 1500);
      return () => window.clearTimeout(id);
    };

    const cancelIdle = scheduleIdle(async () => {
      if (cancelled) return;
      try {
        devLog('[Brain] Lazy-loading VOYO Brain integration...');
        const brain = await import('./brain');
        if (cancelled) return;
        brain.initializeBrainIntegration();
        (window as unknown as { brainStats: typeof brain.getBrainStats }).brainStats = brain.getBrainStats;
        cleanup = brain.cleanupBrainIntegration;
        devLog('[Brain] ready');
      } catch (err) {
        devWarn('[Brain] Failed to lazy-load:', err);
      }
    });

    return () => {
      cancelled = true;
      cancelIdle();
      if (cleanup) {
        devLog('[Brain] Cleaning up VOYO Brain integration');
        cleanup();
      }
    };
  }, []);

  // SCOUTS: Start hungry knowledge discovery agents
  // DISABLED: HungryScouts make 64+ YouTube API calls per session
  // With 324K tracks in Supabase, we don't need real-time scouting
  // Re-enable when YouTube API key is configured and rate limiting is implemented
  // useEffect(() => {
  //   console.log('[Scouts] Starting Hungry Scouts for African music discovery...');
  //   startScoutPatrol(30);
  //   (window as any).scoutStats = getScoutStats;
  //   (window as any).knowledgeStats = getKnowledgeStats;
  //   return () => {
  //     console.log('[Scouts] Stopping scout patrol');
  //     stopScoutPatrol();
  //   };
  // }, []);

  // FIRST-TIME EXPERIENCE: Prime the player with a curated track on cold boot.
  // DEFERRED to after first paint so it doesn't block the splash + cold boot
  // doesn't fight the audio loading flow. The player just shows empty for
  // ~500ms longer if it was going to be empty anyway — invisible to users
  // who already have a saved track.
  useEffect(() => {
    const tid = setTimeout(() => {
      const { currentTrack, queue, playTrack, setIsPlaying } = usePlayerStore.getState();
      if (!currentTrack && queue.length === 0) {
        const primer = TRACKS.find(t => t.trackId === 'WcIcVapfqXw') || TRACKS[0];
        if (primer) {
          playTrack(primer);
          // Immediately pause — playTrack sets isPlaying=true, but we want the
          // player primed and ready, not playing.
          setIsPlaying(false);
          devLog('[VOYO] First-time primer: loaded', primer.title, '(deferred)');
        }
      }
    }, 800);
    return () => clearTimeout(tid);
  }, []);

  // TRACK POOL MAINTENANCE + sync work — DEFERRED to idle so it doesn't
  // race the first track load. Was causing startup audio muffling because
  // ~5 things were running synchronously on mount: pool maintenance start,
  // 2x Supabase batch syncs, refreshRecommendations (324K DB query), all
  // competing with the first track's audio loading + decoding.
  useEffect(() => {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const scheduleIdle = (cb: () => void): number => {
      if (typeof w.requestIdleCallback === 'function') {
        return w.requestIdleCallback(cb, { timeout: 5000 });
      }
      return window.setTimeout(cb, 2000) as unknown as number;
    };
    const cancelIdle = (id: number) => {
      if (typeof w.cancelIdleCallback === 'function') {
        w.cancelIdleCallback(id);
      } else {
        window.clearTimeout(id);
      }
    };

    // FIRST: refresh recommendations immediately so the UI has data fast.
    // This is the only thing the user actually sees on startup.
    usePlayerStore.getState().refreshRecommendations();
    devLog('[VOYO] VIBES FIRST: Loading from 324K database...');

    // SECOND: defer pool maintenance + seed syncs to idle.
    const idleId = scheduleIdle(() => {
      startPoolMaintenance();
      devLog('[VOYO] Track pool maintenance started (deferred)');

      syncSeedTracks(TRACKS).then(count => {
        if (count > 0) devLog(`[VOYO] 🌱 Synced ${count} seed tracks to Supabase`);
      });

      syncManyToDatabase(TRACKS).then(count => {
        if (count > 0) devLog(`[VOYO] 🧠 Synced ${count} seed tracks to video_intelligence`);
      });
    });

    return () => cancelIdle(idleId);
  }, []);

  // REALTIME NOTIFICATIONS: Subscribe to Supabase events for DynamicIsland
  useEffect(() => {
    const { subscribeToReactions, unsubscribeFromReactions } = useReactionStore.getState();

    // Get current DASH ID from localStorage (Command Center auth)
    const getDashId = () => {
      try {
        const stored = localStorage.getItem('dash_citizen_storage');
        if (stored) {
          const parsed = JSON.parse(stored);
          // Handle nested format { state: { citizen: { coreId } } }
          return parsed.state?.citizen?.coreId || parsed.coreId || null;
        }
      } catch { /* ignore */ }
      return null;
    };

    const currentDashId = getDashId();

    // Subscribe to reactions realtime
    subscribeToReactions();

    // Listen for new reactions via store updates
    const unsubReactions = useReactionStore.subscribe((state, prevState) => {
      // Check if new reactions arrived
      if (state.recentReactions.length > prevState.recentReactions.length) {
        const newReaction = state.recentReactions[0];

        // Only notify if reaction is from someone else
        if (newReaction.username !== currentDashId) {
          // Determine notification based on reaction context
          const currentTrack = usePlayerStore.getState().currentTrack;

          // If someone reacted to the track you're currently playing
          if (currentTrack && newReaction.track_id === (currentTrack.trackId || currentTrack.id)) {
            const notifType: 'music' | 'message' | 'system' =
              newReaction.reaction_type === 'fire' ? 'music' :
              newReaction.reaction_type === 'oye' ? 'message' : 'music';

            (window as any).pushNotification?.({
              id: `reaction-${newReaction.id}`,
              type: notifType,
              title: newReaction.username,
              subtitle: `${newReaction.emoji} ${newReaction.reaction_type} on ${newReaction.track_title}`
            });
          }
        }
      }

      // Category pulse notifications (when categories get hot)
      Object.entries(state.categoryPulse).forEach(([category, pulse]) => {
        const prevPulse = prevState.categoryPulse[category as keyof typeof prevState.categoryPulse];

        // Notify when category becomes hot
        if (pulse.isHot && !prevPulse.isHot && pulse.count > 5) {
          (window as any).pushNotification?.({
            id: `pulse-${category}-${Date.now()}`,
            type: 'music',
            title: 'MixBoard',
            subtitle: `${category} is heating up`
          });
        }
      });
    });

    // Subscribe to incoming DMs for DynamicIsland notifications
    let dmUnsubscribe: (() => void) | null = null;
    const setupDMSubscription = async () => {
      try {
        // Static import — voyo-api is already in the main chunk via other static
        // importers (Hub.tsx, ProfilePage.tsx, etc.), so a dynamic import here
        // just triggered a Vite "static and dynamic import" warning without
        // actually splitting anything off.
        const { messagesAPI, isConfigured } = voyoApi;
        if (!isConfigured) return;

        const dashId = getDashId();
        if (!dashId) return;

        // Subscribe returns an unsubscribe function
        dmUnsubscribe = messagesAPI.subscribeToIncoming(dashId, (newMessage) => {
          // Push to DynamicIsland
          (window as any).pushNotification?.({
            id: `dm-${newMessage.id}`,
            type: 'message',
            title: newMessage.from_id,
            subtitle: newMessage.message.slice(0, 50) + (newMessage.message.length > 50 ? '...' : '')
          });
        });
        devLog('📬 [DM] Subscription setup complete');
      } catch (err) {
        devWarn('📬 [DM] Subscription setup failed:', err);
      }
    };
    setupDMSubscription();

    return () => {
      unsubscribeFromReactions();
      unsubReactions();
      if (dmUnsubscribe) {
        dmUnsubscribe();
      }
    };
  }, []);

  // PERSIST APP MODE: Save to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('voyo-app-mode', appMode);
  }, [appMode]);

  // Get background image URL with fallback
  const getBackgroundUrl = () => {
    if (!currentTrack) return '';
    if (bgError) {
      return getYouTubeThumbnail(currentTrack.trackId, 'high');
    }
    return currentTrack.coverUrl;
  };

  // Handle video mode entry/exit
  const handleVideoModeEnter = () => setAppMode('video');
  const handleVideoModeExit = () => setAppMode('voyo');

  // Handle mode switching
  const handleSwitchToVOYO = (tab?: 'music' | 'feed' | 'upload' | 'dahub') => {
    // DEFENSIVE: onClick handlers pass the MouseEvent as the first arg which
    // would otherwise set voyoActiveTab to an event object. Only accept strings.
    const VALID_TABS = ['music', 'feed', 'upload', 'dahub'] as const;
    const validTab = (typeof tab === 'string' && (VALID_TABS as readonly string[]).includes(tab))
      ? tab as typeof VALID_TABS[number]
      : 'music';
    setVoyoTab(validTab);
    setAppMode('voyo');
  };
  const handleSwitchToClassic = () => setAppMode('classic');

  return (
    <AppErrorBoundary>
    <AuthProvider>
    {/*
      Suspense fallback shares the same VOYO wordmark + 3-dots aesthetic as
      the BootLoader (formerly VoyoSplash) so the user sees ONE continuous
      loader. The fallback is the static shell — VoyoSplash mounts on top
      with the boom-expand burst + the actual data preload. Visually they
      stitch into a single screen.
    */}
    <Suspense fallback={
      <div className="h-full w-full bg-[#050508] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="text-3xl font-black tracking-wider" style={{ color: '#8b5cf6', opacity: 0.6 }}>VOYO</span>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-1.5 h-1.5 rounded-full bg-purple-500/50 animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </div>
        </div>
      </div>
    }>
    <div className="relative h-full w-full bg-[#050508] overflow-hidden">
      {/* VOYO Boot Loader — VOYO wordmark + 3 dots + boom-expand ring burst.
          minDuration is 900ms — just enough to see the boom rings expand once
          + the 220ms fade-out. Faster perceived boot, less standing around. */}
      {showSplash && (
        <VoyoSplash onComplete={handleSplashComplete} minDuration={900} />
      )}

      {/* Auto-update banner (Tivi+ pattern) */}
      <UpdateButton />

      {/* Pull-to-refresh indicator (Tivi+ pattern) — fades in as you pull
          down at the top of any view, rotates with the pull distance, fires
          window.location.reload() once threshold is crossed. */}
      {ptr.pulling && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[9998] flex items-center justify-center transition-opacity duration-200"
          style={{
            top: Math.max(0, ptr.pullY - 20),
            opacity: ptr.pullY > 20 ? Math.min(1, ptr.pullY / 60) : 0,
          }}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-md"
            style={{
              background: ptr.refreshing ? 'rgba(139, 92, 246, 0.2)' : 'rgba(0, 0, 0, 0.6)',
              border: `1.5px solid ${ptr.pullY > 40 ? 'rgba(139, 92, 246, 0.55)' : 'rgba(255, 255, 255, 0.18)'}`,
              transform: `rotate(${ptr.pullY * 3}deg)`,
              transition: 'background 0.2s, border-color 0.2s',
            }}
          >
            {ptr.refreshing ? (
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-white/60">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            )}
          </div>
        </div>
      )}

      {/* Dynamic Background based on current track (only for VOYO modes) */}
      {appMode !== 'video' && appMode !== 'classic' && (
        <div className="absolute inset-0 z-0">
          {/* Blurred album art background with fallback */}
          {currentTrack && (
            <div
              className="absolute inset-0"
              key={currentTrack.id}
            >
              <img
                src={getBackgroundUrl()}
                alt=""
                className="absolute inset-0 w-full h-full object-cover blur-3xl opacity-15 scale-110"
                onError={() => setBgError(true)}
              />
            </div>
          )}

          {/* ANIMATED BACKGROUND - User's chosen vibe */}
          <AnimatedBackground type={backgroundType} mood="vibe" />

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0f]/80 via-[#0a0a0f]/50 to-[#0a0a0f]/90" />
        </div>
      )}

      {/* REACTION CANVAS - Reactions float up when tapped */}
      {appMode !== 'video' && appMode !== 'classic' && (
        <ReactionCanvas />
      )}

      {/* Main Content */}
      
        {/* GLOBAL LANDSCAPE OVERRIDE - When landscape, always show video player */}
        {isLandscape && currentTrack ? (
          <LandscapeVOYO onVideoMode={handleVideoModeEnter} />
        ) : appMode === 'classic' ? (
          <div
            key="classic"
            className="relative z-10 h-full"
          >
            <ClassicMode
              onSwitchToVOYO={handleSwitchToVOYO}
              onSearch={() => setIsSearchOpen(true)}
            />
          </div>
        ) : appMode === 'video' ? (
          <div
            key="video"
            className="relative z-10 h-full"
          >
            <VideoMode onExit={handleVideoModeExit} />
          </div>
        ) : (
          <div
            key="voyo"
            className="relative z-10 h-full flex flex-col"
          >
            {/* Top Bar - VOYO Logo & Navigation — fully transparent, ghost buttons */}
            <header
              className="relative flex items-center justify-between px-4 py-3 flex-shrink-0 bg-transparent"
              style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
            >
              {/* Left: VOYO Logo — purple → bronze (brand colors, no pink, no yellow) */}
              <div className="flex items-center">
                <span
                  className="text-2xl font-black tracking-tight"
                  style={{
                    background: 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 50%, #D4A053 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    filter: 'drop-shadow(0 0 12px rgba(139,92,246,0.3))',
                  }}
                >
                  VOYO
                </span>
              </div>

              {/* Center: Dynamic Island Notifications */}
              <div className="flex-1 flex justify-center">
                <DynamicIsland />
              </div>

              {/* Right: Ghost icon buttons — no pill backgrounds */}
              <div className="flex items-center gap-1">
                {/* Search */}
                <button
                  className="p-2 rounded-full active:scale-95 transition-transform"
                  aria-label="Search"
                  onClick={() => setIsSearchOpen(true)}
                >
                  <Search className="w-5 h-5 text-white/60" strokeWidth={1.8} />
                </button>

                {/* DASH Citizen ID */}
                <DashAuthBadge productCode="V" />

                {/* Profile → Voyo Universe */}
                <button
                  className="p-2 rounded-full active:scale-95 transition-transform"
                  aria-label="Profile"
                  onClick={() => setIsProfileOpen(true)}
                >
                  <User className="w-5 h-5 text-white/60" strokeWidth={1.8} />
                </button>
              </div>
            </header>

            {/* VOYO Mode Content - Portrait or Landscape */}
            <div className="flex-1 overflow-hidden">
              {isLandscape ? (
                <LandscapeVOYO onVideoMode={handleVideoModeEnter} />
              ) : (
                <PortraitVOYO
                  onSearch={() => setIsSearchOpen(true)}
                  onDahub={() => setVoyoTab('dahub')}
                  onHome={handleSwitchToClassic}
                />
              )}
            </div>
          </div>
        )}
      


      {/* Audio Player - Boost (cached audio) handles playback */}
      <AudioPlayer />

      {/* OYO Ambient AI Overlay — Phase 2. Mounted once at root, reads
          isInvoked from oyoStore. Long-press the VOYO orb to summon. */}
      <Suspense fallback={null}>
        <OyoInvocation />
      </Suspense>

      {/* YouTube Iframe - GLOBAL for all modes (Classic needs it for streaming) */}
      <YouTubeIframe />

      {/* Search Overlay - Powered by Piped API */}
      <SearchOverlay
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onArtistTap={(name) => { setArtistPageName(name); setIsSearchOpen(false); }}
      />

      {/* Artist Page Overlay */}
      {artistPageName && (
        <ArtistPage
          artistName={artistPageName}
          onClose={() => setArtistPageName(null)}
          onPlayTrack={(trackId, title, artist) => {
            const { playTrack } = usePlayerStore.getState();
            playTrack({
              id: trackId,
              trackId,
              title,
              artist,
              coverUrl: `https://i.ytimg.com/vi/${trackId}/hqdefault.jpg`,
              tags: [],
              oyeScore: 0,
              duration: 0,
              createdAt: new Date().toISOString(),
            });
          }}
        />
      )}

      {/* Background/Vibe Picker - Choose your animated background */}
      <BackgroundPicker
        current={backgroundType}
        onSelect={setBackgroundType}
        isOpen={isBackgroundPickerOpen}
        onClose={() => setIsBackgroundPickerOpen(false)}
      />

      {/* Universe Panel - Full Profile/Settings/Login/Backup */}
      <UniversePanel isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />

      {/* PWA Install Button - Subtle, bottom right */}
      <InstallButton />

      {/* Offline Indicator - Shows when network is lost */}
      <OfflineIndicator />
    </div>
    </Suspense>
    </AuthProvider>
    </AppErrorBoundary>
  );
}

export default App;
