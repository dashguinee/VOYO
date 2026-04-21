/**
 * FirstTimeLoader — welcomes a brand-new user with a name-capture moment
 * that doubles as:
 *   1. Service-worker warm-up window (React/SW caches while the user reads
 *      and types — typically 5–15s of natural dwell).
 *   2. iOS/Safari autoplay unlock via explicit user-gesture audio play.
 *   3. Personalization seed — the captured name flows into useAuth's
 *      localName fallback so the greeting banner and profile icon light
 *      up with the user's name on first Home visit.
 *
 * Gating: renders nothing if localStorage already has `voyo-user-name`.
 * A single-render check in useState initializer keeps it out of the tree
 * for returning users — no flash, no mount cost.
 *
 * Interaction:
 *   · Auto-focuses the input ~500ms after mount (reads as arrival).
 *   · Tap on background: unlocks audio, commits with current name (or
 *     "Friend" fallback if empty) — matches Dash's "tap anywhere to start"
 *     gesture capture.
 *   · Tap on input: unlocks audio, keeps focus, does NOT commit.
 *   · Enter key / Let's go button: unlocks + commits.
 *
 * Fades out over 450ms so the app underneath reveals gracefully.
 */

import { useEffect, useRef, useState } from 'react';
import { LOCAL_NAME_KEY, notifyLocalNameChange } from '../../hooks/useAuth';

const AUDIO_UNLOCK_KEY = 'voyo-audio-unlocked';
const NAME_MAX_LEN = 32;

function hasStoredName(): boolean {
  try {
    const v = localStorage.getItem(LOCAL_NAME_KEY);
    return !!(v && v.trim());
  } catch { return false; }
}

// Silent-oscillator + silent-WAV-Audio combo. The AudioContext resume
// handles iOS 13+ Safari; the <audio> play() helps older iOS + some
// in-app webviews. Both swallow errors — unlock is best-effort, not fatal.
function unlockAudio(): void {
  try {
    type WindowWithAC = Window & {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const w = window as WindowWithAC;
    const AC = w.AudioContext || w.webkitAudioContext;
    if (AC) {
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.001);
    }
  } catch { /* ignore */ }
  try {
    const a = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
    a.volume = 0;
    void a.play().catch(() => {});
  } catch { /* ignore */ }
  try { sessionStorage.setItem(AUDIO_UNLOCK_KEY, '1'); } catch {}
}

export const FirstTimeLoader = () => {
  const [show, setShow] = useState<boolean>(() => !hasStoredName());
  const [name, setName] = useState('');
  const [leaving, setLeaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const unlockedRef = useRef(false);
  const committedRef = useRef(false);

  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => inputRef.current?.focus(), 500);
    return () => clearTimeout(t);
  }, [show]);

  if (!show) return null;

  const handleUnlock = () => {
    if (unlockedRef.current) return;
    unlockedRef.current = true;
    unlockAudio();
  };

  const commit = (raw: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    const clean = raw.trim().slice(0, NAME_MAX_LEN) || 'Friend';
    try { localStorage.setItem(LOCAL_NAME_KEY, clean); } catch {}
    notifyLocalNameChange();
    setLeaving(true);
    setTimeout(() => setShow(false), 450);
  };

  const onBackgroundTap = () => {
    handleUnlock();
    commit(name);
  };

  const onInputAreaClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleUnlock();
  };

  const onButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleUnlock();
    commit(name);
  };

  return (
    <div
      onClick={onBackgroundTap}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center select-none px-6"
      style={{
        opacity: leaving ? 0 : 1,
        transition: 'opacity 450ms ease-out',
        pointerEvents: leaving ? 'none' : 'auto',
        background:
          'radial-gradient(ellipse 110% 80% at 50% 28%, rgba(139,92,246,0.16) 0%, transparent 60%), ' +
          'radial-gradient(ellipse 120% 70% at 50% 88%, rgba(212,160,83,0.10) 0%, transparent 70%), ' +
          '#0a0a0f',
      }}
    >
      {/* Wordmark */}
      <span
        className="text-[44px] font-black tracking-tight leading-none mb-2"
        style={{
          background: 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 50%, #D4A053 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          filter: 'drop-shadow(0 0 16px rgba(139,92,246,0.35))',
        }}
      >
        VOYO
      </span>
      <p className="text-white/40 text-[10px] tracking-[0.35em] uppercase mb-16">
        Music, the way you feel it
      </p>

      <p className="text-white/60 text-sm mb-5">What should we call you?</p>

      <div
        className="relative w-full max-w-[320px]"
        onClick={onInputAreaClick}
      >
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleUnlock();
              commit(name);
            }
          }}
          placeholder="Your name"
          autoComplete="given-name"
          autoCapitalize="words"
          maxLength={NAME_MAX_LEN}
          className="w-full bg-transparent text-white text-center text-[18px] py-2 focus:outline-none placeholder:text-white/20 caret-purple-400"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.2)' }}
        />
      </div>

      <button
        onClick={onButtonClick}
        className="mt-10 px-7 py-2.5 rounded-full text-[13px] font-semibold tracking-wide transition-all active:scale-[0.97]"
        style={{
          background: name.trim()
            ? 'linear-gradient(135deg, rgba(139,92,246,0.9) 0%, rgba(212,160,83,0.8) 100%)'
            : 'rgba(255,255,255,0.08)',
          color: name.trim() ? '#fff' : 'rgba(255,255,255,0.45)',
          boxShadow: name.trim() ? '0 8px 22px rgba(139,92,246,0.35)' : 'none',
        }}
      >
        Let's go
      </button>

      <p className="text-white/25 text-[10px] tracking-[0.3em] uppercase mt-6">
        Tap anywhere to enter
      </p>
    </div>
  );
};

export default FirstTimeLoader;
