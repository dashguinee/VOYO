/**
 * OYO Island - Voice Search & Chat
 *
 * Features:
 * 1. Voice Search - Hold to sing/hum, find songs phonetically (Shazam killer)
 * 2. Chat Mode - Text with OYO for requests ("play Burna Boy")
 * 3. Lyrics Preview - Shows current phonetic lyrics
 *
 * TAP-TO-SHOW BEHAVIOR:
 * - Starts hidden
 * - Single tap on screen → appears
 * - Auto-hides after 5s of inactivity
 * - Tap OYO → chat opens
 * - Tap mic → voice search
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { getProfile } from '../../services/oyoDJ';
import {
  voiceSearch,
  recordFromMicrophone,
  isConfigured as isWhisperConfigured,
  type VoiceSearchResult,
} from '../../services/whisperService';
import {
  getCurrentSegment,
  type EnrichedLyrics,
  type TranslatedSegment,
} from '../../services/lyricsEngine';
import { usePlayerStore } from '../../store/playerStore';
import { app } from '../../services/oyo';
import { searchAlbums, getAlbumTracks } from '../../services/piped';
import { pipedTrackToVoyoTrack } from '../../data/tracks';

// Auto-hide timeout
const AUTO_HIDE_DELAY = 5000; // 5 seconds

async function getCulturalContext(phonetics: string, matchedSong?: string, matchedArtist?: string): Promise<string> {
  try {
    const { callGemini } = await import('../../oyo/providers/gemini');
    const userMessage = matchedSong
      ? `The user sang/hummed: "${phonetics}". This matched: "${matchedSong}" by ${matchedArtist}. In 1-2 short sentences, explain any cultural meaning, language (if not English), or interesting facts. Be casual and friendly like a DJ.`
      : `The user sang/hummed: "${phonetics}". What language might this be? Any cultural context? Keep it to 1 sentence, casual DJ style.`;
    const result = await callGemini({ systemPrompt: 'You are a knowledgeable music DJ.', userMessage });
    return result.text ?? '';
  } catch {
    return '';
  }
}

// ============================================================================
// TYPES
// ============================================================================

type IslandMode = 'collapsed' | 'voice' | 'chat' | 'lyrics';

interface VoiceState {
  isRecording: boolean;
  isProcessing: boolean;
  result?: VoiceSearchResult;
  error?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export interface OyoIslandProps {
  visible: boolean;
  onHide: () => void;
  onActivity?: () => void; // Reset auto-hide timer on any interaction
}

export function OyoIsland({ visible, onHide, onActivity }: OyoIslandProps) {
  const [mode, setMode] = useState<IslandMode>('collapsed');
  const [voiceState, setVoiceState] = useState<VoiceState>({ isRecording: false, isProcessing: false });
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'oyo'; message: string }>>([]);
  const [lyrics, setLyrics] = useState<EnrichedLyrics | null>(null);
  const [currentLyricSegment, setCurrentLyricSegment] = useState<TranslatedSegment | null>(null);
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentTrack = usePlayerStore(state => state.currentTrack);
  // NOTE: currentTime is deliberately NOT subscribed at this level. The
  // lyrics-segment sync lives in an isolated LyricsSegmentSync sub-
  // component at the bottom of this file — it subscribes to currentTime
  // in a render-null wrapper, so the ~900-line OyoIsland tree doesn't
  // re-render at 4Hz during playback.

  const djProfile = getProfile();

  // Auto-hide when in collapsed mode and visible
  useEffect(() => {
    if (visible && mode === 'collapsed') {
      // Clear existing timer
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
      }
      // Set new auto-hide timer
      autoHideTimerRef.current = setTimeout(() => {
        onHide();
      }, AUTO_HIDE_DELAY);
    }

    return () => {
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
      }
    };
  }, [visible, mode, onHide]);

  // Reset timer on any activity
  const handleActivity = useCallback(() => {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
    }
    if (mode === 'collapsed') {
      autoHideTimerRef.current = setTimeout(() => {
        onHide();
      }, AUTO_HIDE_DELAY);
    }
    onActivity?.();
  }, [mode, onHide, onActivity]);

  // Lyrics-segment sync is handled by the LyricsSegmentSync sub-component
  // (rendered below). It subscribes to currentTime independently so the
  // OyoIsland body doesn't re-render at 4Hz.

  // Voice search handler - THE SHAZAM KILLER
  const handleVoiceSearch = useCallback(async () => {
    if (!isWhisperConfigured()) {
      setVoiceState({
        isRecording: false,
        isProcessing: false,
        error: 'Voice search not configured. Add OpenAI API key.',
      });
      return;
    }

    try {
      setVoiceState({ isRecording: true, isProcessing: false });
      setMode('voice');

      // Record for 8 seconds
      const audioBlob = await recordFromMicrophone(8000);
      setVoiceState({ isRecording: false, isProcessing: true });

      // Process with Whisper
      const result = await voiceSearch(audioBlob);
      setVoiceState({ isRecording: false, isProcessing: false, result });

      // Add to chat history
      setChatHistory(prev => [
        ...prev,
        { role: 'user', message: `🎤 "${result.phonetics}"` },
        { role: 'oyo', message: `Searching for: "${result.query}"...` },
      ]);

      // Search for the song
      const searchResults = await searchAlbums(result.query);
      if (searchResults.length > 0) {
        const match = searchResults[0];

        // Get cultural context from Gemini (non-blocking)
        getCulturalContext(result.phonetics, match.name, match.artist).then(context => {
          if (context) {
            setChatHistory(prev => [...prev, { role: 'oyo', message: `💡 ${context}` }]);
          }
        });

        // Get playable tracks from the album/result
        try {
          const tracks = await getAlbumTracks(match.id);
          if (tracks.length > 0) {
            // Convert first track to VOYO format and play
            const voyoTrack = pipedTrackToVoyoTrack(tracks[0], match.thumbnail);

            // Play the track! (setCurrentTrack triggers playback)
            app.playTrack(voyoTrack, 'search');

            setChatHistory(prev => [
              ...prev.slice(0, -1),
              { role: 'oyo', message: `🔥 Found "${match.name}" by ${match.artist}! Playing now...` },
            ]);
          } else {
            setChatHistory(prev => [
              ...prev.slice(0, -1),
              { role: 'oyo', message: `Found "${match.name}" but couldn't get playable track. Try searching directly!` },
            ]);
          }
        } catch {
          setChatHistory(prev => [
            ...prev.slice(0, -1),
            { role: 'oyo', message: `Found "${match.name}" by ${match.artist}! Search it to play.` },
          ]);
        }
      } else {
        setChatHistory(prev => [
          ...prev.slice(0, -1),
          { role: 'oyo', message: `Couldn't find that one. Try humming a bit more, or tell me what you're looking for!` },
        ]);
      }

      setMode('chat');

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Voice search failed';
      setVoiceState({ isRecording: false, isProcessing: false, error: message });
    }
  }, []);

  // Chat submit handler - with play capability AND conversation
  const handleChatSubmit = useCallback(async () => {
    if (!chatInput.trim()) return;

    const userMessage = chatInput.trim();
    const lowerMessage = userMessage.toLowerCase();
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', message: userMessage }]);

    // Check for play intent keywords
    const playIntent = /^(play|queue|hit|drop|spin)\s+/i.test(userMessage);

    // Check for music search intent (explicit song/artist references)
    const musicIntent = playIntent ||
      /\b(song|track|music|album|artist|by|feat|ft\.?|featuring)\b/i.test(userMessage) ||
      /^(find|search|look for|got any)\s+/i.test(userMessage);

    // Conversation responses - when NOT looking for music
    if (!musicIntent) {
      // Greetings
      if (/^(hey|hi|hello|yo|sup|what'?s? ?up|wazzguan|wazguan)/i.test(lowerMessage)) {
        setChatHistory(prev => [...prev, { role: 'oyo', message: "Yo! What's good? 🎧 Need a vibe or just chillin'?" }]);
        return;
      }
      // How are you
      if (/how (are|r) (you|u)|how('?s| is) it going/i.test(lowerMessage)) {
        setChatHistory(prev => [...prev, { role: 'oyo', message: "I'm vibin'! 🔥 Ready to drop some heat. What you wanna hear?" }]);
        return;
      }
      // Thanks
      if (/^(thanks|thank you|thx|ty|appreciate)/i.test(lowerMessage)) {
        setChatHistory(prev => [...prev, { role: 'oyo', message: "Anytime fam! 🤙 Hit me up when you need more vibes" }]);
        return;
      }
      // What can you do
      if (/what (can|do) you do|help|commands/i.test(lowerMessage)) {
        setChatHistory(prev => [...prev, { role: 'oyo', message: "I'm your DJ! 🎵 Say 'play [song]' to hear something, or just chat. I can also hum-search with 🎤!" }]);
        return;
      }
      // Mood/recommendation request
      if (/recommend|suggest|something (good|fire|chill|hype)|what should i/i.test(lowerMessage)) {
        setChatHistory(prev => [...prev, { role: 'oyo', message: "What's the vibe? Chill? Hype? Afrobeats? Tell me the mood and I'll hook you up! 🎯" }]);
        return;
      }
      // Fallback for short non-music messages
      if (userMessage.length < 15 && !/[A-Z]/.test(userMessage.slice(1))) {
        setChatHistory(prev => [...prev, { role: 'oyo', message: "I'm here! 🎧 Want me to play something? Just say 'play [song name]'" }]);
        return;
      }
    }

    // Music search flow
    const searchQuery = playIntent ? userMessage.replace(/^(play|queue|hit|drop|spin)\s+/i, '') : userMessage;
    setChatHistory(prev => [...prev, { role: 'oyo', message: `Searching for "${searchQuery}"...` }]);

    // Search for the track
    const searchResults = await searchAlbums(searchQuery);
    if (searchResults.length > 0) {
      const match = searchResults[0];

      // If play intent, get tracks and play immediately
      if (playIntent) {
        try {
          const tracks = await getAlbumTracks(match.id);
          if (tracks.length > 0) {
            const voyoTrack = pipedTrackToVoyoTrack(tracks[0], match.thumbnail);
            app.playTrack(voyoTrack, 'search');

            setChatHistory(prev => [
              ...prev.slice(0, -1),
              { role: 'oyo', message: `🔥 Playing "${match.name}" by ${match.artist}!` },
            ]);

            // Get cultural context (non-blocking)
            getCulturalContext(searchQuery, match.name, match.artist).then(context => {
              if (context) {
                setChatHistory(prev => [...prev, { role: 'oyo', message: `💡 ${context}` }]);
              }
            });
          }
        } catch {
          setChatHistory(prev => [
            ...prev.slice(0, -1),
            { role: 'oyo', message: `Found "${match.name}" but couldn't load it. Try the search bar!` },
          ]);
        }
      } else {
        // Just show results, ask if user wants to play
        setChatHistory(prev => [
          ...prev.slice(0, -1),
          { role: 'oyo', message: `Found "${match.name}" by ${match.artist}. Say "play ${match.name}" to hear it!` },
        ]);
      }
    } else {
      setChatHistory(prev => [
        ...prev.slice(0, -1),
        { role: 'oyo', message: `Couldn't find "${searchQuery}". Try different words or use 🎤 to hum it!` },
      ]);
    }
  }, [chatInput]);

  // Mode change handlers that also trigger activity
  const expandToChat = useCallback(() => {
    handleActivity();
    setMode('chat');
  }, [handleActivity]);

  const expandToLyrics = useCallback(() => {
    handleActivity();
    setMode('lyrics');
  }, [handleActivity]);

  const collapseToIsland = useCallback(() => {
    setMode('collapsed');
    // Timer will auto-start via useEffect
  }, []);

  // Don't render if not visible
  if (!visible) return null;

  // Render based on mode
  return (
    <>
      {mode === 'collapsed' && (
        <CollapsedIsland
          key="collapsed"
          djName={djProfile.name}
          onExpand={expandToChat}
          onVoicePress={handleVoiceSearch}
          hasLyrics={!!lyrics}
          onLyricsPress={expandToLyrics}
        />
      )}

      {mode === 'voice' && (
        <VoiceIsland
          key="voice"
          state={voiceState}
          djName={djProfile.name}
          onCancel={() => {
            setVoiceState({ isRecording: false, isProcessing: false });
            collapseToIsland();
            }}
        />
      )}

      {mode === 'chat' && (
        <ChatIsland
          key="chat"
          djName={djProfile.name}
          history={chatHistory}
          input={chatInput}
          onInputChange={(val) => { handleActivity(); setChatInput(val); }}
          onSubmit={() => { handleActivity(); handleChatSubmit(); }}
          onVoicePress={handleVoiceSearch}
          onCollapse={collapseToIsland}
        />
      )}

      {mode === 'lyrics' && currentLyricSegment && (
        <LyricsIsland
          key="lyrics"
          segment={currentLyricSegment}
          onClose={collapseToIsland}
        />
      )}

      {/* LYRICS SYNC — isolated sub-component. Subscribes to currentTime
          at 4Hz and computes the active segment, calling setCurrentLyricSegment
          on the parent. Produces no DOM (returns null). Lets the parent
          OyoIsland body skip 4Hz re-renders during playback. */}
      {lyrics && <LyricsSegmentSync lyrics={lyrics} onSegmentChange={setCurrentLyricSegment} />}
    </>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// LyricsSegmentSync — renders null. Its only job is to subscribe to
// currentTime and translate it into a parent state update. React.memo
// plus the stable setter prop means this is the ONLY thing in the
// OyoIsland tree that re-renders at the 4Hz store-write cadence.
const LyricsSegmentSync = memo(({
  lyrics,
  onSegmentChange,
}: {
  lyrics: EnrichedLyrics;
  onSegmentChange: (seg: TranslatedSegment | null) => void;
}) => {
  const currentTime = usePlayerStore(state => state.currentTime);
  useEffect(() => {
    if (currentTime === undefined) return;
    onSegmentChange(getCurrentSegment(lyrics, currentTime));
  }, [lyrics, currentTime, onSegmentChange]);
  return null;
});
LyricsSegmentSync.displayName = 'LyricsSegmentSync';

function CollapsedIsland({
  djName,
  onExpand,
  onVoicePress,
  hasLyrics,
  onLyricsPress,
}: {
  djName: string;
  onExpand: () => void;
  onVoicePress: () => void;
  hasLyrics: boolean;
  onLyricsPress: () => void;
}) {
  // Decontracted = circle/pill (resting). Clean glass bar.
  // VOYO DNA: same material language as the nav bar glass.
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-[voyo-fade-in_0.3s_ease-out]">
      <div
        style={{
          background: 'rgba(10,10,14,0.85)',
          borderRadius: '999px',
          padding: '6px 6px 6px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        {/* DJ Name — tap to expand chat */}
        <button
          onClick={onExpand}
          className="active:scale-95 transition-transform"
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.85)',
            fontSize: '13px',
            fontWeight: '600',
            cursor: 'pointer',
            letterSpacing: '0.02em',
          }}
        >
          {djName}
        </button>

        {/* Action buttons — pill-shaped, minimal */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {/* Voice */}
          <button
            onClick={onVoicePress}
            className="active:scale-90 transition-transform"
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'rgba(255,255,255,0.6)',
              fontSize: '15px',
            }}
            aria-label="Voice search"
          >
            🎤
          </button>

          {/* Lyrics (if available) */}
          {hasLyrics && (
            <button
              onClick={onLyricsPress}
              className="active:scale-90 transition-transform"
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'rgba(255,255,255,0.6)',
                fontSize: '15px',
              }}
              aria-label="Show lyrics"
            >
              📝
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


function VoiceIsland({
  state,
  djName,
  onCancel,
}: {
  state: VoiceState;
  djName: string;
  onCancel: () => void;
}) {
  // VOYO DNA: circle (decontracted) → square (contracted/active).
  // When recording, the panel morphs from rounded-24px to 16px (square
  // VOYO orb press-to-square morph). Color shifts from purple to warm
  // golden-brown (Araba palette) to signal "I'm actively listening."
  const isActive = state.isRecording;

  return (
    <div className="fixed top-4 left-4 right-4 z-50">
      <div
        style={{
          background: 'linear-gradient(145deg, rgba(10,10,14,0.96), rgba(22,22,28,0.98))',
          // MORPH: circle (24px) when idle → square (16px) when recording
          borderRadius: isActive ? '16px' : '24px',
          padding: '24px',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          // Border shifts from subtle white to warm golden when active
          border: isActive
            ? '1px solid rgba(180,135,70,0.35)'
            : '1px solid rgba(255,255,255,0.08)',
          // Shadow shifts to golden glow when active
          boxShadow: isActive
            ? '0 12px 40px rgba(0,0,0,0.5), 0 0 30px rgba(180,135,70,0.12)'
            : '0 12px 40px rgba(0,0,0,0.5)',
          textAlign: 'center' as const,
          // Smooth morph between states
          transition: 'border-radius 0.4s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.3s ease-out, box-shadow 0.3s ease-out',
        }}
      >
        {/* Mic indicator — morphs circle↔square in sync with panel */}
        <div
          style={{
            width: '72px',
            height: '72px',
            // Same morph: circle → square
            borderRadius: isActive ? '18px' : '50%',
            background: isActive
              ? 'linear-gradient(135deg, rgba(180,135,70,0.25), rgba(140,100,50,0.15))'
              : 'rgba(255,255,255,0.06)',
            border: isActive
              ? '1.5px solid rgba(196,148,90,0.4)'
              : '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '28px',
            margin: '0 auto 16px',
            transition: 'border-radius 0.4s cubic-bezier(0.16, 1, 0.3, 1), background 0.3s ease-out, border-color 0.3s ease-out',
            // Pulse animation when recording
            animation: isActive ? 'voyo-orb-pulse 1.5s ease-in-out infinite' : 'none',
          }}
        >
          {state.isProcessing ? '⏳' : '🎤'}
        </div>

        <p style={{
          color: isActive ? 'rgba(196,148,90,0.95)' : 'white',
          fontSize: '15px',
          fontWeight: '600',
          marginBottom: '4px',
          transition: 'color 0.3s ease-out',
        }}>
          {state.isRecording && 'Listening...'}
          {state.isProcessing && 'Processing...'}
          {state.error && 'Error'}
        </p>

        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '12px', marginBottom: '16px' }}>
          {state.isRecording && `${djName} is finding your song`}
          {state.isProcessing && 'Analyzing with Whisper AI...'}
          {state.error && state.error}
        </p>

        <button
          onClick={onCancel}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: '12px',
            padding: '10px 24px',
            color: 'rgba(255,255,255,0.7)',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ChatIsland({
  djName,
  history,
  input,
  onInputChange,
  onSubmit,
  onVoicePress,
  onCollapse,
}: {
  djName: string;
  history: Array<{ role: 'user' | 'oyo'; message: string }>;
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onVoicePress: () => void;
  onCollapse: () => void;
}) {
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  return (
    <div
      className="fixed bottom-20 right-4 z-50"
      style={{ width: '320px', maxWidth: 'calc(100vw - 32px)' }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(0,0,0,0.95) 0%, rgba(20,20,20,0.98) 100%)',
          borderRadius: '20px',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          }}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              }}
          >
            🎧
          </div>
          <span style={{ color: 'white', fontWeight: '600', flex: 1 }}>{djName}</span>
          <button
            onClick={onCollapse}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              fontSize: '18px',
              cursor: 'pointer',
              }}
          >
            ×
          </button>
        </div>

        {/* Chat History */}
        <div
          style={{
            height: '200px',
            overflowY: 'auto',
            padding: '12px',
            }}
        >
          {history.length === 0 && (
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', textAlign: 'center', marginTop: '60px' }}>
              Ask {djName} for music recommendations or use 🎤 to search by voice!
            </p>
          )}
          {history.map((msg, i) => (
            <div
              key={i}
              style={{
                marginBottom: '10px',
                textAlign: msg.role === 'user' ? 'right' : 'left',
                }}
            >
              <div
                style={{
                  display: 'inline-block',
                  maxWidth: '80%',
                  padding: '8px 12px',
                  borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: msg.role === 'user'
                    ? 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)'
                    : 'rgba(255,255,255,0.1)',
                  color: 'white',
                  fontSize: '13px',
                  }}
              >
                {msg.message}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div
          style={{
            padding: '12px',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            gap: '8px',
            }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && onSubmit()}
            placeholder={`Ask ${djName}...`}
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: '12px',
              padding: '10px 14px',
              color: 'white',
              fontSize: '14px',
              outline: 'none',
              }}
          />
          <button
            onClick={onVoicePress}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '16px',
              }}
          >
            🎤
          </button>
        </div>
      </div>
    </div>
  );
}

function LyricsIsland({
  segment,
  onClose,
}: {
  segment: TranslatedSegment;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed bottom-24 left-4 right-4 z-50"
    >
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(0,0,0,0.9) 0%, rgba(20,20,20,0.95) 100%)',
          borderRadius: '20px',
          padding: '20px',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(236,72,153,0.3)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.5)',
            fontSize: '18px',
            cursor: 'pointer',
            }}
        >
          ×
        </button>

        {/* Original Lyrics */}
        <p style={{
          color: 'white',
          fontSize: '18px',
          fontWeight: '600',
          marginBottom: '8px',
          textAlign: 'center',
        }}>
          {segment.original}
        </p>

        {/* Phonetic */}
        <p style={{
          color: 'rgba(139,92,246,0.9)',
          fontSize: '14px',
          fontStyle: 'italic',
          marginBottom: '12px',
          textAlign: 'center',
        }}>
          {segment.phonetic}
        </p>

        {/* Translations */}
        {segment.english && (
          <p style={{
            color: 'rgba(255,255,255,0.7)',
            fontSize: '14px',
            marginBottom: '4px',
            textAlign: 'center',
          }}>
            🇬🇧 {segment.english}
          </p>
        )}
        {segment.french && (
          <p style={{
            color: 'rgba(255,255,255,0.7)',
            fontSize: '14px',
            textAlign: 'center',
          }}>
            🇫🇷 {segment.french}
          </p>
        )}

        {/* Word breakdown */}
        {segment.translations.length > 0 && (
          <div style={{
            marginTop: '12px',
            paddingTop: '12px',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            justifyContent: 'center',
          }}>
            {segment.translations.map((t, i) => (
              <div
                key={i}
                style={{
                  background: 'rgba(139,92,246,0.2)',
                  borderRadius: '8px',
                  padding: '4px 8px',
                  fontSize: '12px',
                  }}
              >
                <span style={{ color: 'white' }}>{t.original}</span>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}> → </span>
                <span style={{ color: '#EC4899' }}>{t.english || t.french}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default OyoIsland;
