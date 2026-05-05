/**
 * OYO Island - Chat & Voice Search
 *
 * Features:
 * 1. Chat Mode - Text with OYO for requests ("play Burna Boy") — opens immediately on show
 * 2. Voice Search - Hum/sing to find songs phonetically (reachable via handleVoiceSearch)
 * 3. Lyrics Preview - Shows current phonetic lyrics when available
 *
 * SHOW/HIDE BEHAVIOR:
 * - Starts hidden; parent controls `visible`
 * - Single tap on player canvas → appears, opens directly to chat, clears previous history
 * - × button (or cancel in voice mode) → parent notified via onHide()
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { oyo } from '../../oyo';
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
  // currentTime and currentTrack are NOT subscribed here — LyricsSegmentSync
  // (render-null sub-component) handles currentTime in isolation so the
  // OyoIsland body doesn't re-render at 4Hz during playback.

  const djProfile = getProfile();
  const submittingRef = useRef(false);

  // Open directly to chat whenever the island becomes visible.
  // Also clear chat history on each new invocation so users don't land on
  // stale context from a previous session — OYO always starts fresh.
  const prevVisibleRef = useRef(false);
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      setMode('chat');
      setChatHistory([]);
      setVoiceState({ isRecording: false, isProcessing: false });
    }
    prevVisibleRef.current = visible;
  }, [visible]);

  // Notify parent of in-island activity (parent may reset its own auto-hide)
  const handleActivity = useCallback(() => {
    onActivity?.();
  }, [onActivity]);

  // Lyrics-segment sync is handled by the LyricsSegmentSync sub-component
  // (rendered below). It subscribes to currentTime independently so the
  // OyoIsland body doesn't re-render at 4Hz.

  // Voice search handler - THE SHAZAM KILLER
  const handleVoiceSearch = useCallback(async () => {
    if (submittingRef.current) return;
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
        { role: 'oyo', message: `"${result.query}"...` },
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
              { role: 'oyo', message: `Found it. Playing "${match.name}" — ${match.artist}.` },
            ]);
          } else {
            setChatHistory(prev => [
              ...prev.slice(0, -1),
              { role: 'oyo', message: `"${match.name}" — not loading right now. Try the search bar.` },
            ]);
          }
        } catch {
          setChatHistory(prev => [
            ...prev.slice(0, -1),
            { role: 'oyo', message: `"${match.name}" by ${match.artist}. Tap to play it.` },
          ]);
        }
      } else {
        setChatHistory(prev => [
          ...prev.slice(0, -1),
          { role: 'oyo', message: `Nothing came back. Hum it again or give me different words.` },
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
    if (!chatInput.trim() || submittingRef.current) return;

    const userMessage = chatInput.trim();
    const lowerMessage = userMessage.toLowerCase();
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', message: userMessage }]);

    // Check for play intent keywords
    const playIntent = /^(play|queue|hit|drop|spin)\s+/i.test(userMessage);

    // Genre/vibe requests — route to OYO brain (searchByGenre/searchByVibe tools)
    // even if they start with "play", because Piped can't handle "play some afrobeats"
    const GENRE_VIBE_PATTERN = /\b(afrobeats?|amapiano|kizomba|zouk|dancehall|gqom|afrohouse|r&b|rnb|hip[- ]?hop|trap|drill|grime|reggae|afropop|afrofusion|lo[- ]?fi|gospel|jazz|soul|funk|highlife|mbalax|bongo[- ]?flava|gengetone|hiplife|soca|makossa|bikutsi|soukous|ndombolo|kwaito|rumba)\b/i;
    const isGenreVibe = GENRE_VIBE_PATTERN.test(userMessage);
    const isVibeRequest = /\b(chill|relax|vibe|hype|party|workout|late night|focus|study|sad|romantic)\b/i.test(userMessage);
    const routeToBrain = isGenreVibe || isVibeRequest;

    // Check for music search intent (explicit song/artist references)
    const musicIntent = !routeToBrain && (playIntent ||
      /\b(song|track|music|album|artist|by|feat|ft\.?|featuring)\b/i.test(userMessage) ||
      /^(find|search|look for|got any)\s+/i.test(userMessage));

    // Non-music conversational intent OR genre/vibe request → route through the full OYO brain
    if (!musicIntent) {
      submittingRef.current = true;
      try {
        const playerState = usePlayerStore.getState();
        const playerTrack = playerState.currentTrack;
        const recentPlays = playerState.history
          .slice(-5)
          .reverse()
          .map((h) => ({
            trackId: h.track.trackId,
            title: h.track.title,
            artist: h.track.artist,
            genre: h.track.tags?.[0],
          }));
        const context = {
          ...(playerTrack ? {
            currentTrack: {
              trackId: playerTrack.trackId,
              title: playerTrack.title,
              artist: playerTrack.artist,
              genre: playerTrack.tags?.[0],
            },
          } : {}),
          ...(recentPlays.length > 0 ? { recentPlays } : {}),
          userLocale: navigator.language,
        };
        const result = await oyo.think({ userMessage, context, surface: 'player' });
        setChatHistory(prev => [...prev, { role: 'oyo', message: result.response || '...' }]);
      } catch {
        setChatHistory(prev => [...prev, { role: 'oyo', message: "Signal dropped. Try again." }]);
      } finally {
        submittingRef.current = false;
      }
      return;
    }

    // Music search flow
    const searchQuery = playIntent ? userMessage.replace(/^(play|queue|hit|drop|spin)\s+/i, '') : userMessage;
    setChatHistory(prev => [...prev, { role: 'oyo', message: `"${searchQuery}"...` }]);

    // Guard concurrent async submissions — set before first await so the
    // event loop can't re-enter this path while a search is in flight.
    submittingRef.current = true;
    try {
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
                { role: 'oyo', message: `On it. "${match.name}" — ${match.artist}.` },
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
              { role: 'oyo', message: `"${match.name}" won't load. Try the search bar.` },
            ]);
          }
        } else {
          // Just show results, ask if user wants to play
          setChatHistory(prev => [
            ...prev.slice(0, -1),
            { role: 'oyo', message: `"${match.name}" by ${match.artist}. Say "play" to drop it.` },
          ]);
        }
      } else {
        setChatHistory(prev => [
          ...prev.slice(0, -1),
          { role: 'oyo', message: `"${searchQuery}" — nothing. Different angle or hum it.` },
        ]);
      }
    } finally {
      submittingRef.current = false;
    }
  }, [chatInput]);

  // Collapse (×, cancel) = dismiss the island entirely. Calling onHide
  // lets the parent know to update its showOyoIsland state, which drives
  // the `visible` prop — so the island unmounts cleanly instead of going
  // dark while still technically mounted.
  const collapseToIsland = useCallback(() => {
    onHide();
  }, [onHide]);

  // Don't render if not visible
  if (!visible) return null;

  // Render based on mode
  return (
    <>
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
          {state.isRecording && 'Listening.'}
          {state.isProcessing && 'Reading.'}
          {state.error && 'No signal.'}
        </p>

        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '12px', marginBottom: '16px' }}>
          {state.isRecording && 'On it.'}
          {state.isProcessing && 'Breaking it down.'}
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
  onCollapse,
}: {
  djName: string;
  history: Array<{ role: 'user' | 'oyo'; message: string }>;
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
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
              background: 'linear-gradient(135deg, #D4A053 0%, #B8862E 100%)',
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
              Name a track, hum something, or describe what you're feeling.
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
                    ? 'linear-gradient(135deg, rgba(212,160,83,0.32) 0%, rgba(184,134,46,0.28) 100%)'
                    : 'rgba(255,255,255,0.08)',
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
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && onSubmit()}
            placeholder="Name it."
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
            onClick={onSubmit}
            disabled={!input.trim()}
            style={{
              background: input.trim() ? 'rgba(212,160,83,0.35)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${input.trim() ? 'rgba(212,160,83,0.5)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: '12px',
              padding: '10px 14px',
              color: input.trim() ? '#D4A053' : 'rgba(255,255,255,0.3)',
              fontSize: '14px',
              cursor: input.trim() ? 'pointer' : 'default',
              transition: 'all 0.15s ease',
              flexShrink: 0,
            }}
          >
            Send
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
