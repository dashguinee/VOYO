/**
 * OYO DJ Bar — OYO's voice, rendered as an input surface.
 *
 * Not a notification. Not a chat. An ambient control surface that appears
 * when OYO makes a deliberate move (bridge, echo, peak, or a notable flow
 * transition). Shows what OYO is thinking in one line + two choices.
 *
 * The choices aren't replies — they're standardized vibe intents that
 * steer the conductor's next fetch. User taps one → OYO adjusts.
 * No tap → OYO continues on its arc, bar auto-dismisses.
 *
 * Position: above the player bar. Appears from bottom, auto-fades after 8s.
 * Character: confident, culturally-rooted, economy of language.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { DJAnnouncement, VibeIntent } from '../../services/oyo/djAnnounce';
import { onAnnouncement } from '../../services/oyo';

interface OyoDJBarProps {
  /** Pixels from the bottom (to clear the player bar). Default 110. */
  bottomOffset?: number;
  /** Called when user taps a choice. */
  onSteer: (intent: VibeIntent) => void;
}

const AUTO_DISMISS_MS = 8_000;

export function OyoDJBar({ bottomOffset = 110, onSteer }: OyoDJBarProps) {
  const [current, setCurrent] = useState<DJAnnouncement | null>(null);
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    setLeaving(true);
    setTimeout(() => {
      setVisible(false);
      setLeaving(false);
      setCurrent(null);
    }, 350);
  }, []);

  const scheduleAutoDismiss = useCallback(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS);
  }, [dismiss]);

  // Subscribe to DJ announcements — skip when app is backgrounded
  useEffect(() => {
    const unsub = onAnnouncement((ann) => {
      if (document.hidden) return;
      setCurrent(ann);
      setLeaving(false);
      setVisible(true);
      scheduleAutoDismiss();
    });
    return () => {
      unsub();
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [scheduleAutoDismiss]);

  const handleChoice = useCallback((intent: VibeIntent) => {
    onSteer(intent);
    dismiss();
  }, [onSteer, dismiss]);

  if (!visible || !current) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: bottomOffset,
        left: 12,
        right: 12,
        zIndex: 45,
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'translateY(8px)' : 'translateY(0)',
        transition: 'opacity 350ms ease, transform 350ms cubic-bezier(0.16,1,0.3,1)',
        animation: !leaving ? 'oyo-dj-bar-in 320ms cubic-bezier(0.16,1,0.3,1)' : undefined,
      }}
    >
      <style>{`
        @keyframes oyo-dj-bar-in {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
      `}</style>

      <div
        style={{
          background: 'linear-gradient(135deg, rgba(12,12,16,0.97) 0%, rgba(20,20,26,0.99) 100%)',
          borderRadius: 18,
          border: '1px solid rgba(212,160,83,0.18)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(212,160,83,0.06)',
          padding: '11px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {/* Golden OYO dot */}
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'rgba(212,160,83,0.85)',
            flexShrink: 0,
            boxShadow: '0 0 8px rgba(212,160,83,0.4)',
          }}
        />

        {/* DJ text */}
        <span
          style={{
            flex: 1,
            color: 'rgba(255,255,255,0.88)',
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            lineHeight: 1.3,
          }}
        >
          {current.text}
        </span>

        {/* Two choice buttons */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {current.choices.map((choice, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); handleChoice(choice.intent); }}
              style={{
                background: 'rgba(212,160,83,0.12)',
                border: '1px solid rgba(212,160,83,0.28)',
                borderRadius: 10,
                padding: '5px 10px',
                color: 'rgba(212,160,83,0.9)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                letterSpacing: '0.01em',
                whiteSpace: 'nowrap',
                transition: 'background 120ms ease, border-color 120ms ease',
              }}
              onPointerDown={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(212,160,83,0.22)';
              }}
              onPointerUp={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(212,160,83,0.12)';
              }}
              onPointerLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(212,160,83,0.12)';
              }}
            >
              {choice.label}
            </button>
          ))}
        </div>

        {/* Dismiss × */}
        <button
          onClick={(e) => { e.stopPropagation(); dismiss(); }}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.25)',
            fontSize: 16,
            cursor: 'pointer',
            padding: '0 2px',
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

export default OyoDJBar;
