/**
 * DynamicIsland — iPhone-style notification pill + reply surface.
 *
 * One pill, three states:
 *   COLLAPSED  — small dark pill showing the current notification
 *                preview. Wave-on-arrival, settles to dark, fades.
 *                Drag horizontally to cycle queued notifications.
 *                Drag up to dismiss.
 *   EXPANDED   — full card with title/subtitle + action buttons
 *                (queue/like for music, reply for message, view for
 *                system). Stays until the user acts.
 *   REPLYING   — purple-wave card with text input (tap to type) and
 *                tap-to-speak voice mode (countdown → record → send).
 *
 * Sources: window.pushNotification(), useDashNotifications realtime
 * stream, dev-only demo timers. All deduped by id, capped at NOTIF_CAP
 * in memory. Notifications originating from dash_notifications get
 * marked read on dismiss/action so future loads keep the read state.
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useDashNotifications, type DashNotification } from '../../hooks/useDashNotifications';
import { useAuth } from '../../hooks/useAuth';
import { devLog, devWarn } from '../../utils/logger';
import { trace } from '../../services/telemetry';

// ── Types ────────────────────────────────────────────────────────────

type NotifType = 'music' | 'message' | 'system' | 'admin';

interface Notification {
  id: string;
  type: NotifType;
  title: string;
  subtitle: string;
  read?: boolean;
  color?: string;
  url?: string;
}

interface DynamicIslandProps {
  /** App code that this mount represents. Filters dash_notifications to
   * rows with app in ('all', appCode). Default: 'voyo'. */
  appCode?: 'voyo' | 'hub' | 'giraf' | string;
  /** Current user's dash_id — enables target_user filtering. Optional. */
  dashId?: string | null;
}

/**
 * Phase machine. Replaces the previous 5 booleans + 'wave|dark|idle'
 * tag with one source of truth.
 *
 *   hidden     → nothing on screen, no queue activity worth surfacing
 *   wave       → fresh notification, liquid-purple intro (WAVE_MS)
 *   dark       → settled compact pill (DARK_MS before fading)
 *   fading     → opacity ramp out (FADE_MS)
 *   dot        → minimal corner pulse, user can tap to resurface
 *   expanded   → big card with actions, no auto-fade
 *   replying   → reply input + voice surface, no auto-fade
 *   sending    → reply submitted, fade-and-clear ramp
 */
type Phase = 'hidden' | 'wave' | 'dark' | 'fading' | 'dot' | 'expanded' | 'replying' | 'sending';

// ── Tunables ─────────────────────────────────────────────────────────

const NOTIF_CAP = 20; // hard cap on in-memory queue
const DRAG_X_THRESHOLD = 40;
const DRAG_Y_THRESHOLD = 40;

const TIMING = {
  WAVE_MS:           3000,
  DARK_MS:           3000,
  FADE_MS:            600,
  DOT_AUTO_HIDE_MS:  3000,
  TRANSITION_MS:      300,
  SEND_RAMP_MS:       800,
  REPLY_FOCUS_MS:     500,
  COUNTDOWN_STEP_MS: 1000,
} as const;

// ── Color helpers ────────────────────────────────────────────────────

const TYPE_COLOR: Record<NotifType, string> = {
  music:   '#a855f7',
  message: '#8b5cf6',
  system:  '#ef4444',
  admin:   '#ef4444',
};

const dotColor = (n: Notification | undefined): string =>
  n?.color ?? (n ? TYPE_COLOR[n.type] : '#71717a');

// ── Mappers ──────────────────────────────────────────────────────────

const mapDashNotification = (row: DashNotification): Notification => ({
  id: row.id,
  type: row.app === 'hub' || row.app === 'all' ? 'admin' : 'system',
  title: row.title,
  subtitle: row.body || '',
  url: row.url ?? undefined,
  read: row.read,
});

// ── Component ────────────────────────────────────────────────────────

export const DynamicIsland = ({
  appCode = 'voyo',
  dashId: dashIdProp = null,
}: DynamicIslandProps = {}) => {
  // Resolve dashId from auth if not passed — lets App.tsx mount as <DynamicIsland />
  const { dashId: authDashId } = useAuth();
  const dashId = dashIdProp ?? authDashId ?? null;

  // ── Core state ─────────────────────────────────────────────────────
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('hidden');
  const [replyText, setReplyText] = useState('');
  const [transcript, setTranscript] = useState('');
  const [waveformLevels, setWaveformLevels] = useState<number[]>([0.3, 0.3, 0.3, 0.3, 0.3]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  // mediaRecorderRef can't drive renders — mirror its truthy/falsy state
  // here so the reply UI knows when to show the recording surface.
  const [isRecording, setIsRecording] = useState(false);

  const currentNotification = notifications[currentIndex];
  const hasQueue = notifications.length > 0;
  const unreadCount = notifications.filter((n) => !n.read).length;

  // ── Refs ───────────────────────────────────────────────────────────
  const phaseTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const replyInputRef = useRef<HTMLInputElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const dashOriginIdsRef = useRef<Set<string>>(new Set()); // ids that came from dash_notifications

  // Drag tracking (pointer events on the container)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragHandledRef = useRef(false);

  // Voice recording resources
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  // SpeechRecognition isn't reliably typed cross-browser; keep loose to avoid
  // surface-area lib changes pulling in optional polyfill types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  // ── Phase timer helpers ────────────────────────────────────────────
  const clearPhaseTimers = useCallback(() => {
    phaseTimersRef.current.forEach(clearTimeout);
    phaseTimersRef.current = [];
  }, []);

  const schedulePhase = useCallback(
    (delayMs: number, next: Phase) => {
      phaseTimersRef.current.push(setTimeout(() => setPhase(next), delayMs));
    },
    [],
  );

  // ── Lifecycle entry/exit transitions ──────────────────────────────
  const playWaveSequence = useCallback(() => {
    clearPhaseTimers();
    setPhase('wave');
    schedulePhase(TIMING.WAVE_MS, 'dark');
    schedulePhase(TIMING.WAVE_MS + TIMING.DARK_MS, 'fading');
  }, [clearPhaseTimers, schedulePhase]);

  const playResurface = useCallback(() => {
    clearPhaseTimers();
    setPhase('dark');
    schedulePhase(TIMING.DARK_MS, 'fading');
  }, [clearPhaseTimers, schedulePhase]);

  // After a fading phase, settle into 'dot' (queue still has items) or
  // 'hidden' (nothing left). Driven off `phase === 'fading'` so it
  // automatically follows wave/dark/manual sequences.
  useEffect(() => {
    if (phase !== 'fading') return;
    const t = setTimeout(
      () => setPhase(hasQueue ? 'dot' : 'hidden'),
      TIMING.FADE_MS,
    );
    return () => clearTimeout(t);
  }, [phase, hasQueue]);

  // ── Notification buffer management ────────────────────────────────
  const enqueue = useCallback(
    (notif: Notification, fromDash = false) => {
      trace('dn_enqueue', null, { id: notif.id, type: notif.type, src: fromDash ? 'dash' : 'push' });
      setNotifications((prev) => {
        // Dedup by id — replace existing if same id
        const without = prev.filter((p) => p.id !== notif.id);
        const next = [...without, notif];
        // Hard cap prevents unbounded growth
        const capped = next.length > NOTIF_CAP ? next.slice(-NOTIF_CAP) : next;
        setCurrentIndex(capped.length - 1);
        return capped;
      });
      if (fromDash) dashOriginIdsRef.current.add(notif.id);
      playWaveSequence();
    },
    [playWaveSequence],
  );

  // Diagnostic — fires once on mount so we can confirm the component
  // is actually rendering in this view + which appCode/dashId it's
  // listening for. Pair with `dn_dash_rows` and `dn_enqueue` traces
  // to follow the notification chain.
  useEffect(() => {
    trace('dn_mount', null, { appCode, dashId: dashId ? dashId.slice(-8) : null });
  }, [appCode, dashId]);

  // ── Realtime ingest from useDashNotifications ─────────────────────
  const { notifications: dashRows, markRead: markDashRead } = useDashNotifications({
    appCode,
    dashId,
  });

  useEffect(() => {
    trace('dn_dash_rows', null, { total: dashRows.length, seen: seenIdsRef.current.size });
    if (dashRows.length === 0) return;
    const fresh = dashRows.filter((r) => !seenIdsRef.current.has(r.id));
    if (fresh.length === 0) return;
    fresh.forEach((r) => seenIdsRef.current.add(r.id));
    // Newest-first in dashRows — reverse so newest is appended last and becomes current.
    fresh.slice().reverse().forEach((r) => enqueue(mapDashNotification(r), true));
  }, [dashRows, enqueue]);

  // ── window.pushNotification bridge ────────────────────────────────
  useEffect(() => {
    window.pushNotification = (notif: Notification) => enqueue(notif);
    return () => { delete window.pushNotification; };
  }, [enqueue]);

  // ── Dev-only demo notifications ───────────────────────────────────
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const t1 = setTimeout(() => window.pushNotification?.({ id: 'demo-1', type: 'music',   title: 'Burna Boy', subtitle: 'Higher just dropped'        }),  1000);
    const t2 = setTimeout(() => window.pushNotification?.({ id: 'demo-2', type: 'message', title: 'Aziz',      subtitle: 'yo come check this out'     }),  8000);
    const t3 = setTimeout(() => window.pushNotification?.({ id: 'demo-3', type: 'system',  title: 'VOYO',      subtitle: 'notification system ready'  }), 15000);
    return () => { [t1, t2, t3].forEach(clearTimeout); };
  }, []);

  // ── Phase pause when expanded/replying/sending ────────────────────
  useEffect(() => {
    if (phase === 'expanded' || phase === 'replying' || phase === 'sending') {
      clearPhaseTimers();
    }
  }, [phase, clearPhaseTimers]);

  // ── Dismiss helpers ───────────────────────────────────────────────
  const removeAt = useCallback(
    (idx: number) => {
      setNotifications((prev) => {
        const target = prev[idx];
        if (target && dashOriginIdsRef.current.has(target.id)) {
          // Mark read in the dahub so future loads don't replay it
          try { markDashRead(target.id); } catch { /* fire-and-forget */ }
          dashOriginIdsRef.current.delete(target.id);
        }
        const next = prev.filter((_, i) => i !== idx);
        setCurrentIndex((cur) => Math.min(cur, Math.max(0, next.length - 1)));
        return next;
      });
    },
    [markDashRead],
  );

  const dismissCurrent = useCallback(() => {
    clearPhaseTimers();
    setPhase('fading');
    phaseTimersRef.current.push(
      setTimeout(() => {
        removeAt(currentIndex);
      }, TIMING.FADE_MS),
    );
  }, [clearPhaseTimers, currentIndex, removeAt]);

  // ── Tap to expand ↔ collapse ──────────────────────────────────────
  const handleTap = useCallback(() => {
    clearPhaseTimers();
    if (phase === 'expanded' || phase === 'replying') {
      setPhase('dark');
      schedulePhase(TIMING.DARK_MS, 'fading');
    } else {
      setPhase('expanded');
    }
  }, [clearPhaseTimers, phase, schedulePhase]);

  // ── Manual resurface from dot ─────────────────────────────────────
  const handleDotTap = useCallback(() => {
    if (!hasQueue) return;
    playResurface();
  }, [hasQueue, playResurface]);

  // ── Drag (horizontal nav + swipe-up dismiss) ───────────────────────
  const navigate = useCallback(
    (delta: -1 | 1, withTransition = false) => {
      const next = currentIndex + delta;
      if (next < 0 || next >= notifications.length) return;
      if (withTransition) {
        setIsTransitioning(true);
        setTimeout(() => {
          setCurrentIndex(next);
          setTimeout(() => setIsTransitioning(false), TIMING.TRANSITION_MS);
        }, TIMING.TRANSITION_MS);
      } else {
        setCurrentIndex(next);
      }
    },
    [currentIndex, notifications.length],
  );

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    dragHandledRef.current = false;
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragStartRef.current || dragHandledRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;

      // Swipe-up dismiss
      if (-dy > DRAG_Y_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
        dragHandledRef.current = true;
        dismissCurrent();
        return;
      }

      // Horizontal nav — wave transition only when expanded
      if (Math.abs(dx) > DRAG_X_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
        dragHandledRef.current = true;
        navigate(dx > 0 ? -1 : 1, phase === 'expanded' || phase === 'replying');
      }
    },
    [dismissCurrent, navigate, phase],
  );

  const onPointerUp = useCallback(() => {
    dragStartRef.current = null;
  }, []);

  // ── Keyboard nav when expanded ─────────────────────────────────────
  useEffect(() => {
    if (phase !== 'expanded' && phase !== 'replying') return;
    const onKey = (e: KeyboardEvent) => {
      if (phase === 'replying') {
        // Let the input handle its own keys; only Esc collapses
        if (e.key === 'Escape') { e.preventDefault(); setPhase('expanded'); }
        return;
      }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); navigate(-1, true); }
      if (e.key === 'ArrowRight') { e.preventDefault(); navigate(1, true); }
      if (e.key === 'Escape')     { e.preventDefault(); handleTap(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, navigate, handleTap]);

  // ── Action handlers ────────────────────────────────────────────────
  const handleAction = useCallback(
    (action: string) => {
      devLog(`[DynamicIsland] action=${action}`, currentNotification?.title);
      removeAt(currentIndex);
      if (notifications.length > 1) {
        setPhase('hidden');
        setTimeout(() => playResurface(), TIMING.FADE_MS);
      } else {
        setPhase('hidden');
      }
    },
    [currentIndex, currentNotification, notifications.length, playResurface, removeAt],
  );

  const handleReplyMode = useCallback(() => {
    setPhase('replying');
    setTimeout(() => replyInputRef.current?.focus(), TIMING.REPLY_FOCUS_MS);
  }, []);

  // ── Voice recording ────────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    try { audioContextRef.current?.close(); } catch { /* already closed */ }
    audioContextRef.current = null;
    analyserRef.current = null;
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    recognitionRef.current = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream?.getTracks().forEach((t) => t.stop());
      } catch { /* already stopped */ }
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setWaveformLevels([0.3, 0.3, 0.3, 0.3, 0.3]);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 32;
      audioContextRef.current.createMediaStreamSource(stream).connect(analyserRef.current);

      const updateWaveform = () => {
        if (!analyserRef.current) return;
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        setWaveformLevels(Array.from(data.slice(0, 5)).map((v) => Math.max(0.2, v / 255)));
        animationRef.current = requestAnimationFrame(updateWaveform);
      };
      updateWaveform();

      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        recognitionRef.current = new SR();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recognitionRef.current.onresult = (event: any) => {
          const text = Array.from(event.results)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((r: any) => r?.[0]?.transcript ?? '')
            .join('');
          setTranscript(text);
        };
        try { recognitionRef.current.start(); } catch { /* may have already started */ }
      }

      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      devWarn('[DynamicIsland] mic access denied:', err);
      setCountdown(null);
      setIsRecording(false);
    }
  }, []);

  const handleVoiceTap = useCallback(() => {
    if (countdown !== null || mediaRecorderRef.current) return;
    setTranscript('');
    setCountdown(3);
    phaseTimersRef.current.push(setTimeout(() => setCountdown(2), TIMING.COUNTDOWN_STEP_MS));
    phaseTimersRef.current.push(setTimeout(() => setCountdown(1), TIMING.COUNTDOWN_STEP_MS * 2));
    phaseTimersRef.current.push(setTimeout(() => {
      setCountdown(null);
      void startRecording();
    }, TIMING.COUNTDOWN_STEP_MS * 3));
  }, [countdown, startRecording]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setReplyText(e.target.value);
      // Typing cancels any pending voice mode
      if (countdown !== null || mediaRecorderRef.current) {
        stopRecording();
        setCountdown(null);
      }
    },
    [countdown, stopRecording],
  );

  const handleSendReply = useCallback(() => {
    const isVoice = isRecording;
    const content = replyText.trim() || (isVoice ? '[voice note]' : '');
    if (!content) return;

    devLog('[DynamicIsland] reply', currentNotification?.title, {
      type: isVoice ? 'voice' : 'text',
      content,
      transcript: isVoice ? transcript : null,
    });

    stopRecording();
    setPhase('sending');

    phaseTimersRef.current.push(
      setTimeout(() => {
        setReplyText('');
        setTranscript('');
        setCountdown(null);
        removeAt(currentIndex);
        if (notifications.length > 1) {
          setPhase('hidden');
          setTimeout(() => playResurface(), TIMING.FADE_MS);
        } else {
          setPhase('hidden');
        }
      }, TIMING.SEND_RAMP_MS),
    );
  }, [
    isRecording,
    replyText,
    transcript,
    currentNotification,
    stopRecording,
    removeAt,
    currentIndex,
    notifications.length,
    playResurface,
  ]);

  // ── Cleanup on unmount ─────────────────────────────────────────────
  useEffect(
    () => () => {
      clearPhaseTimers();
      stopRecording();
    },
    [clearPhaseTimers, stopRecording],
  );

  // ── Derived display flags ──────────────────────────────────────────
  const isCollapsed = phase === 'wave' || phase === 'dark' || phase === 'fading';
  const isReplying  = phase === 'replying' || phase === 'sending';
  const isSending   = phase === 'sending';
  const isFading    = phase === 'fading';
  const showWave    = phase === 'wave';
  const showDot     = phase === 'dot' && hasQueue;

  // Memoized container drag handlers — same instance so React doesn't
  // detach/reattach event listeners between renders.
  const dragHandlers = useMemo(
    () => ({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp }),
    [onPointerDown, onPointerMove, onPointerUp],
  );

  // ── Render ─────────────────────────────────────────────────────────

  if (showDot) {
    return (
      <div
        className="cursor-pointer flex-1 h-8 flex items-center justify-center"
        onClick={handleDotTap}
        style={{ minWidth: 120 }}
        aria-label={`${notifications.length} notification${notifications.length === 1 ? '' : 's'} — tap to view`}
      >
        <div
          className="w-2 h-2 rounded-full voyo-island-dot-pulse"
          style={{ backgroundColor: dotColor(currentNotification) }}
        />
        <style>{`
          @keyframes voyo-island-dot {
            0%, 100% { opacity: 0.55; transform: scale(1); }
            50%      { opacity: 1;    transform: scale(1.3); }
          }
          .voyo-island-dot-pulse {
            animation: voyo-island-dot 2.4s ease-in-out infinite;
            box-shadow: 0 0 6px currentColor;
          }
          @media (prefers-reduced-motion: reduce) {
            .voyo-island-dot-pulse { animation: none; opacity: 0.7; }
          }
        `}</style>
      </div>
    );
  }

  if (phase === 'hidden' || !hasQueue) return null;

  // Collapsed pill style (wave/dark/fading). Width clamped via min() so the
  // pill never eats more than ~50vw on iPhone SE (375) where the header's
  // gap-2 siblings + profile + search would otherwise wrap or clip.
  const collapsedStyle: CSSProperties = {
    width: showWave ? 'min(190px, 50vw)' : 'min(165px, 50vw)',
    height: showWave ? 30 : 26,
    paddingLeft: showWave ? 16 : 14,
    paddingRight: showWave ? 16 : 14,
    opacity: isFading ? 0 : 1,
    transition: 'opacity 600ms ease, width 240ms cubic-bezier(0.16, 1, 0.3, 1), height 240ms cubic-bezier(0.16, 1, 0.3, 1)',
    touchAction: 'none',
  };

  // Expanded card style. Background is animated via two STACKED panels
  // (light + dark) cross-faded by opacity rather than animating
  // `background-color` directly — Safari can interpolate the alpha through
  // ~0 and flash a transparent gap mid-transition (research §2F). Same
  // visual outcome, no flash.
  const expandedStyle: CSSProperties = {
    width: isSending ? 200 : isReplying ? 300 : 280,
    opacity: isSending ? 0 : 1,
    borderColor: isReplying ? 'rgba(168,85,247,0.3)' : 'rgba(255,255,255,0.2)',
    transition: 'opacity 380ms ease, width 280ms cubic-bezier(0.16, 1, 0.3, 1), border-color 380ms ease',
    touchAction: 'none',
  };

  return (
    <div className="z-20" {...dragHandlers}>
      {isCollapsed ? (
        // ── COLLAPSED ────────────────────────────────────────────────
        <div className="cursor-pointer" onClick={handleTap}>
          <div
            className={`relative flex items-center gap-2 backdrop-blur-md border rounded-full overflow-hidden ${
              showWave ? 'border-white/40' : 'bg-black/50 border-white/10'
            }`}
            style={collapsedStyle}
          >
            {/* LIQUID WAVE — only on fresh arrivals */}
            {showWave && (
              <div className="absolute inset-0 overflow-hidden">
                <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, #7c3aed 0%, #8b5cf6 25%, #a78bfa 50%, #7c3aed 75%, #5b21b6 100%)', backgroundSize: '200% 100%' }} />
                <div className="absolute inset-0 opacity-60" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 30%, rgba(139,92,246,0.6) 50%, rgba(255,255,255,0.4) 70%, transparent 100%)', backgroundSize: '150% 100%' }} />
                <div className="absolute inset-0 opacity-40" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.8) 45%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0.8) 55%, transparent 100%)', backgroundSize: '80% 100%' }} />
              </div>
            )}

            {/* Dot */}
            <span
              className="relative z-10 w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: showWave ? '#fff' : dotColor(currentNotification) }}
            />

            {/* Preview text */}
            <span
              className={`relative z-10 text-[10px] truncate lowercase ${
                showWave ? 'text-white font-semibold' : 'text-white/70'
              }`}
            >
              {currentNotification?.subtitle}
            </span>

            {/* Queue badge */}
            {unreadCount > 1 && (
              <span
                className={`relative z-10 text-[9px] flex-shrink-0 ${
                  showWave ? 'text-white/90' : 'text-white/30'
                }`}
              >
                +{unreadCount - 1}
              </span>
            )}
          </div>
        </div>
      ) : (
        // ── EXPANDED ─────────────────────────────────────────────────
        <div className="cursor-pointer" onClick={handleTap}>
          <div
            className="relative backdrop-blur-md rounded-2xl shadow-xl border overflow-hidden"
            style={expandedStyle}
          >
            {/* Stacked background panels — cross-fade by opacity instead of
                animating background-color, which on Safari interpolates the
                alpha through ~0 and flashes a transparent gap. Both panels
                are mounted always; only their opacity transitions. */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundColor: 'rgba(255,255,255,0.95)',
                opacity: isReplying ? 0 : 1,
                transition: 'opacity 380ms ease',
              }}
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundColor: 'rgba(0,0,0,0.8)',
                opacity: isReplying ? 1 : 0,
                transition: 'opacity 380ms ease',
              }}
            />

            {/* Wave overlay during reply or transition */}
            {(isReplying || isTransitioning) && (
              <div className="absolute inset-0 overflow-hidden">
                <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, #4c1d95 0%, #7c3aed 25%, #8b5cf6 50%, #a78bfa 75%, #4c1d95 100%)', backgroundSize: '200% 100%' }} />
                <div className="absolute inset-0 opacity-50" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(240,171,252,0.5) 30%, rgba(255,255,255,0.4) 50%, rgba(240,171,252,0.5) 70%, transparent 100%)', backgroundSize: '150% 100%' }} />
                <div className="absolute inset-0 opacity-30" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.9) 48%, rgba(255,255,255,1) 50%, rgba(255,255,255,0.9) 52%, transparent 100%)', backgroundSize: '60% 100%' }} />
              </div>
            )}

            {/* Nav dots — only when there's >1 notification AND not replying */}
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
                // Normal expanded — actions
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
                        +Bucket
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
                // Reply mode — type or tap to speak
                <div
                  className="space-y-2"
                  style={{ opacity: isSending ? 0 : 1 }}
                  onClick={handleVoiceTap}
                >
                  <p className="text-[10px] text-white/80 font-medium">
                    → {currentNotification?.title}
                  </p>

                  {countdown !== null ? (
                    <div className="flex items-center justify-center py-2" key={countdown}>
                      <span className="text-2xl font-bold text-white">{countdown}</span>
                    </div>
                  ) : isRecording ? (
                    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1 py-2">
                        {waveformLevels.map((level, i) => (
                          <div
                            key={i}
                            className="w-1 bg-purple-400 rounded-full"
                            style={{ height: `${Math.round(8 + level * 24)}px`, transition: 'height 80ms linear' }}
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
                    <div className="space-y-2">
                      <div className="flex gap-2 items-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          ref={replyInputRef}
                          type="text"
                          value={replyText}
                          onChange={handleInputChange}
                          onKeyDown={(e) => e.key === 'Enter' && handleSendReply()}
                          placeholder="Type..."
                          // 16px font-size prevents iOS focus-zoom (research §1
                          // #8). Visual weight unchanged — the island reads the
                          // same, the keyboard just doesn't punch the page.
                          className="flex-1 px-4 py-2 rounded-full bg-white/10 border-0 text-white text-base placeholder:text-white/40 focus:outline-none"
                          style={{ caretColor: '#f0abfc', fontSize: 16 }}
                        />
                        {replyText.trim() && (
                          <button
                            // 44×44 hit zone, the 32px disc visual lives inside.
                            // Was w-8 h-8 (32×32) — below the 44px touch floor.
                            className="w-11 h-11 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0"
                            onClick={handleSendReply}
                            aria-label="Send reply"
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

export default DynamicIsland;
