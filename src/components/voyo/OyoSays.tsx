/**
 * OyoSays — ambient Dynamic Island message pill.
 *
 * Listens for window CustomEvent 'voyo:oyo-says' { detail: { text } } and
 * shows a one-shot fade-in/hold/fade-out pill at the top of the viewport.
 * Auto-dismisses after ~3.4s. Latest event wins (no queue) — these are
 * vibes, not announcements; if a new one fires while another is showing,
 * the new text takes over without breaking the rhythm.
 *
 * Usage:
 *   window.dispatchEvent(new CustomEvent('voyo:oyo-says', {
 *     detail: { text: "I'm ready" }
 *   }));
 *
 * Mount once high in the tree (App or VoyoPortraitPlayer) — single-instance.
 */

import { useEffect, useRef, useState } from 'react';

const HOLD_MS = 2400;
const FADE_MS = 500;

type Phase = 'hidden' | 'in' | 'hold' | 'out';

export function OyoSays() {
  const [text, setText] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('hidden');
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  useEffect(() => {
    const onSay = (e: Event) => {
      const detail = (e as CustomEvent<{ text?: string }>).detail;
      const next = (detail?.text || '').trim();
      if (!next) return;

      clearTimers();
      setText(next);
      setPhase('in');

      // tiny delay to let the in-class commit, then mark hold
      timersRef.current.push(setTimeout(() => setPhase('hold'), 16));
      timersRef.current.push(setTimeout(() => setPhase('out'), 16 + HOLD_MS));
      timersRef.current.push(setTimeout(() => {
        setPhase('hidden');
        setText(null);
      }, 16 + HOLD_MS + FADE_MS));
    };

    window.addEventListener('voyo:oyo-says', onSay as EventListener);
    return () => {
      window.removeEventListener('voyo:oyo-says', onSay as EventListener);
      clearTimers();
    };
  }, []);

  if (!text) return null;

  const visible = phase === 'in' || phase === 'hold';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 14px)',
        left: '50%',
        transform: `translateX(-50%) translateY(${visible ? 0 : -8}px) scale(${visible ? 1 : 0.96})`,
        opacity: visible ? 1 : 0,
        transition: `opacity ${FADE_MS}ms cubic-bezier(0.16, 1, 0.3, 1), transform ${FADE_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
        zIndex: 80,
        pointerEvents: 'none',
        padding: '8px 16px',
        borderRadius: 999,
        background: 'rgba(8,8,12,0.78)',
        backdropFilter: 'blur(14px)',
        border: '1px solid rgba(196,181,253,0.30)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.55), 0 0 22px rgba(139,92,246,0.22), 0 0 38px rgba(244,162,62,0.10)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        maxWidth: 'min(82vw, 360px)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6, height: 6, borderRadius: '50%',
          background: '#FBBF77',
          boxShadow: '0 0 6px rgba(251,191,119,0.85), 0 0 12px rgba(244,162,62,0.45)',
        }}
      />
      <span style={{
        color: '#fff',
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>{text}</span>
    </div>
  );
}

OyoSays.displayName = 'OyoSays';

/**
 * Convenience helper. Falls back to a no-op if window isn't available.
 */
export function oyoSays(text: string): void {
  if (typeof window === 'undefined' || !text) return;
  try {
    window.dispatchEvent(new CustomEvent('voyo:oyo-says', { detail: { text } }));
  } catch { /* never break the page */ }
}
