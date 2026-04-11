/**
 * OyoChat
 * -------
 * Conversational layer that lives below the MercuryOrb in the
 * invocation overlay.
 *
 * Design principles:
 *  - LESS chat app, MORE companion summoning
 *  - OYO's lines float as bronze-glow text, NO message bubbles
 *  - User's lines are right-aligned plain white text
 *  - Most recent 5 turns visible, older fade up into the dream
 *  - Input at bottom: minimal glass surface, bronze send arrow
 *
 * Wires straight into the Phase-1 brain via `oyo.think()`. Tool calls
 * (play track, queue songs, etc.) execute inside the brain — we just
 * render OYO's text response.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { oyo } from '../oyo';

export type ChatRole = 'user' | 'oyo';

export interface ChatTurn {
  id: string;
  role: ChatRole;
  text: string;
  timestamp: number;
}

interface OyoChatProps {
  initialGreeting: string;
  onThinkingChange?: (thinking: boolean) => void;
  onDismiss: () => void;
}

export interface OyoChatHandle {
  reset: (greeting: string) => void;
}

const MAX_VISIBLE = 5;

function makeId() {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const OyoChat = forwardRef<OyoChatHandle, OyoChatProps>(function OyoChat(
  { initialGreeting, onThinkingChange, onDismiss },
  ref,
) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Seed with the contextual greeting (re-runs whenever the parent picks
  // a new greeting on a fresh invocation)
  useEffect(() => {
    setTurns([
      { id: makeId(), role: 'oyo', text: initialGreeting, timestamp: Date.now() },
    ]);
    // Focus the input shortly after mount so the keyboard pops on mobile
    const id = setTimeout(() => inputRef.current?.focus(), 320);
    return () => clearTimeout(id);
  }, [initialGreeting]);

  useImperativeHandle(
    ref,
    () => ({
      reset: (greeting: string) => {
        setTurns([
          { id: makeId(), role: 'oyo', text: greeting, timestamp: Date.now() },
        ]);
        setInput('');
      },
    }),
    [],
  );

  useEffect(() => {
    onThinkingChange?.(thinking);
  }, [thinking, onThinkingChange]);

  // ESC handler — dismiss
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const handleSend = useCallback(async () => {
    const message = input.trim();
    if (!message || thinking) return;

    // Quick exit phrases
    const exitPhrases = ['see you later', 'bye oyo', 'goodbye oyo', 'later oyo'];
    if (exitPhrases.some((p) => message.toLowerCase().includes(p))) {
      setTurns((prev) => [
        ...prev,
        { id: makeId(), role: 'user', text: message, timestamp: Date.now() },
        { id: makeId(), role: 'oyo', text: 'Stay good. I got you.', timestamp: Date.now() },
      ]);
      setInput('');
      setTimeout(() => onDismiss(), 900);
      return;
    }

    setTurns((prev) => [
      ...prev,
      { id: makeId(), role: 'user', text: message, timestamp: Date.now() },
    ]);
    setInput('');
    setThinking(true);

    try {
      const result = await oyo.think({ userMessage: message });
      setTurns((prev) => [
        ...prev,
        {
          id: makeId(),
          role: 'oyo',
          text: result.response || '...',
          timestamp: Date.now(),
        },
      ]);
    } catch (err) {
      console.warn('[OyoChat] think failed', err);
      setTurns((prev) => [
        ...prev,
        {
          id: makeId(),
          role: 'oyo',
          text: "Mmm. Lost the signal a sec. Try me again?",
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setThinking(false);
      // Re-focus input after the reply lands so the user can keep going
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [input, thinking, onDismiss]);

  // Only the last MAX_VISIBLE turns are rendered to keep the DOM light
  const visible = turns.slice(-MAX_VISIBLE);

  return (
    <>
      {/* Floating turn stream — sits ABOVE the orb */}
      <div
        className="absolute left-0 right-0 flex flex-col items-center px-6 pointer-events-none"
        style={{
          top: 'max(56px, env(safe-area-inset-top))',
          bottom: '50%',
          marginBottom: 160, // clear of the orb
          gap: 6,
          justifyContent: 'flex-end',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {visible.map((t, idx) => {
          // Older turns fade more
          const fromTop = visible.length - 1 - idx;
          const opacity = Math.max(0.28, 1 - fromTop * 0.22);
          if (t.role === 'oyo') {
            return (
              <div
                key={t.id}
                className="text-center max-w-[88%] pointer-events-auto"
                style={{
                  fontFamily: "'Outfit', system-ui, sans-serif",
                  fontSize: 18,
                  fontWeight: 500,
                  color: '#f3e9d1',
                  lineHeight: 1.35,
                  textShadow:
                    '0 0 22px rgba(212,160,83,0.55), 0 0 8px rgba(212,160,83,0.4), 0 1px 2px rgba(0,0,0,0.6)',
                  opacity,
                  letterSpacing: '0.005em',
                  transition: 'opacity 480ms ease-out',
                }}
              >
                {t.text}
              </div>
            );
          }
          return (
            <div
              key={t.id}
              className="self-end max-w-[78%] pointer-events-auto"
              style={{
                fontFamily: "'Outfit', system-ui, sans-serif",
                fontSize: 15,
                fontWeight: 400,
                color: 'rgba(255,255,255,0.85)',
                opacity,
                textAlign: 'right',
                textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                transition: 'opacity 480ms ease-out',
              }}
            >
              {t.text}
            </div>
          );
        })}
      </div>

      {/* Input row — bottom of screen */}
      <div
        className="absolute left-0 right-0 px-4 pointer-events-auto"
        style={{
          bottom: 'max(20px, env(safe-area-inset-bottom))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="mx-auto max-w-[440px] flex items-center gap-2"
          style={{
            background: 'rgba(20, 14, 32, 0.55)',
            backdropFilter: 'blur(18px) saturate(140%)',
            WebkitBackdropFilter: 'blur(18px) saturate(140%)',
            border: '1px solid rgba(212, 160, 83, 0.18)',
            borderRadius: 26,
            padding: '6px 8px 6px 18px',
            boxShadow:
              '0 4px 24px rgba(0,0,0,0.5), 0 0 28px rgba(212,160,83,0.08), inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={thinking ? 'OYO is thinking…' : 'Talk to OYO…'}
            disabled={thinking}
            aria-label="Message OYO"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'white',
              fontFamily: "'Outfit', system-ui, sans-serif",
              fontSize: 15,
              fontWeight: 400,
              letterSpacing: '0.005em',
              padding: '8px 0',
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || thinking}
            aria-label="Send message to OYO"
            style={{
              flexShrink: 0,
              width: 38,
              height: 38,
              borderRadius: '50%',
              background:
                input.trim() && !thinking
                  ? 'linear-gradient(135deg, #D4A053 0%, #b8862e 100%)'
                  : 'rgba(255,255,255,0.06)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: input.trim() && !thinking ? 'pointer' : 'default',
              transition: 'background 200ms ease, transform 120ms ease',
              transform: input.trim() && !thinking ? 'scale(1)' : 'scale(0.94)',
              boxShadow:
                input.trim() && !thinking
                  ? '0 0 16px rgba(212,160,83,0.45)'
                  : 'none',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 12h14M13 5l7 7-7 7"
                stroke={input.trim() && !thinking ? 'white' : 'rgba(255,255,255,0.35)'}
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>
      </div>
    </>
  );
});

export default OyoChat;
