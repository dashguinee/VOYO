/**
 * VOYO Boost Settings Panel
 *
 * Manage boost settings:
 * - Enable/disable auto-boost
 * - WiFi-only toggle
 * - View/clear cached tracks
 * - Storage usage
 */

import { useState, useEffect, useRef } from 'react';
import { Zap, Trash2, X, HardDrive, Settings, Sliders, Flame, Moon, Timer } from 'lucide-react';
import { useDownloadStore } from '../../store/downloadStore';
import { usePlayerStore } from '../../store/playerStore';
import { haptics } from '../../utils/haptics';

interface BoostSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

// ============================================
// SLEEP TIMER — fade out + pause after N minutes.
// Essential quality-of-life for evening listening.
// ============================================
const SLEEP_OPTIONS = [
  { mins: 5,  label: '5m' },
  { mins: 15, label: '15m' },
  { mins: 30, label: '30m' },
  { mins: 60, label: '1h' },
];

function SleepTimerSection() {
  const [activeMinutes, setActiveMinutes] = useState<number | null>(() => {
    // Restore from sessionStorage so the timer survives settings close/open
    try {
      const saved = sessionStorage.getItem('voyo-sleep-timer-end');
      if (saved) {
        const end = parseInt(saved, 10);
        const remaining = end - Date.now();
        if (remaining > 0) return Math.ceil(remaining / 60000);
      }
    } catch {}
    return null;
  });
  const [remaining, setRemaining] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endTimeRef = useRef<number>(0);

  const startTimer = (mins: number) => {
    // Clear any existing timer
    if (timerRef.current) clearInterval(timerRef.current);

    const endMs = Date.now() + mins * 60000;
    endTimeRef.current = endMs;
    setActiveMinutes(mins);
    try { sessionStorage.setItem('voyo-sleep-timer-end', String(endMs)); } catch {}

    haptics.light();

    timerRef.current = setInterval(() => {
      const left = endTimeRef.current - Date.now();
      if (left <= 0) {
        // TIME'S UP — fade out audio then pause
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setActiveMinutes(null);
        setRemaining('');
        try { sessionStorage.removeItem('voyo-sleep-timer-end'); } catch {}

        // Gentle 10-second fade-out via the audio element's volume
        // (not masterGain — don't mess with the Web Audio chain)
        const el = document.querySelector('audio') as HTMLAudioElement | null;
        if (el && !el.paused) {
          const startVol = el.volume;
          let step = 0;
          const fade = setInterval(() => {
            step++;
            el.volume = Math.max(0, startVol * (1 - step / 40)); // 40 steps × 250ms = 10s
            if (step >= 40) {
              clearInterval(fade);
              usePlayerStore.getState().togglePlay(); // pause
              el.volume = startVol; // restore for next play
            }
          }, 250);
        } else {
          usePlayerStore.getState().setIsPlaying(false);
        }
        return;
      }
      // Update countdown display
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      setRemaining(`${m}:${s.toString().padStart(2, '0')}`);
    }, 1000);
  };

  const cancelTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setActiveMinutes(null);
    setRemaining('');
    try { sessionStorage.removeItem('voyo-sleep-timer-end'); } catch {}
    haptics.light();
  };

  // Restore timer on mount if sessionStorage has a future end time
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('voyo-sleep-timer-end');
      if (saved) {
        const end = parseInt(saved, 10);
        const left = end - Date.now();
        if (left > 0) {
          endTimeRef.current = end;
          startTimer(Math.ceil(left / 60000));
        }
      }
    } catch {}
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bg-white/5 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <Moon size={18} style={{ color: 'rgba(160,120,60,0.7)' }} />
          <div>
            <div className="text-sm font-medium text-white">Sleep</div>
            <div className="text-[10px] text-gray-500">
              {activeMinutes ? `${remaining} remaining` : 'Fades out gently'}
            </div>
          </div>
        </div>
        {activeMinutes && (
          <button
            onClick={cancelTimer}
            className="text-[10px] text-gray-400 hover:text-white px-2 py-1 rounded-lg bg-white/5 active:scale-95 transition-all"
          >
            Cancel
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {SLEEP_OPTIONS.map(({ mins, label }) => (
          <button
            key={mins}
            onClick={() => activeMinutes === mins ? cancelTimer() : startTimer(mins)}
            className={`py-2 rounded-xl text-xs font-medium transition-all active:scale-95 ${
              activeMinutes === mins
                ? 'bg-white/10 border border-white/25 text-white'
                : 'bg-white/[0.03] border border-white/8 text-gray-500 hover:bg-white/5'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export const BoostSettings = ({ isOpen, onClose }: BoostSettingsProps) => {
  // Fine-grained selectors — avoid re-render on every download progress tick.
  const autoBoostEnabled = useDownloadStore(s => s.autoBoostEnabled);
  const enableAutoBoost = useDownloadStore(s => s.enableAutoBoost);
  const disableAutoBoost = useDownloadStore(s => s.disableAutoBoost);
  const cachedTracks = useDownloadStore(s => s.cachedTracks);
  const cacheSize = useDownloadStore(s => s.cacheSize);
  const clearAllDownloads = useDownloadStore(s => s.clearAllDownloads);
  const manualBoostCount = useDownloadStore(s => s.manualBoostCount);

  // Battery fix: fine-grained selectors to avoid re-render on progress/currentTime changes
  const boostProfile = usePlayerStore(s => s.boostProfile);
  const setBoostProfile = usePlayerStore(s => s.setBoostProfile);
  const oyeBarBehavior = usePlayerStore(s => s.oyeBarBehavior);
  const setOyeBarBehavior = usePlayerStore(s => s.setOyeBarBehavior);
  const voyexSpatial = usePlayerStore(s => s.voyexSpatial);
  const setVoyexSpatial = usePlayerStore(s => s.setVoyexSpatial);

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleClearCache = async () => {
    setIsClearing(true);
    await clearAllDownloads();
    setIsClearing(false);
    setShowClearConfirm(false);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center animate-voyo-fade-in">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="relative w-full max-w-md max-h-[75vh] bg-[#111114]/95 backdrop-blur-xl border-t border-white/10 rounded-t-3xl overflow-hidden flex flex-col animate-voyo-spring-in-bottom"
      >
        {/* Handle */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1 bg-white/20 rounded-full z-10" />

        {/* Header — VOYEX Araba TM branding */}
        <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, rgba(139,100,50,0.22), rgba(90,65,35,0.12))',
                border: '1px solid rgba(160,120,60,0.30)',
                boxShadow: '0 0 14px rgba(139,100,50,0.18)',
              }}
            >
              <Settings size={18} style={{ color: '#C4945A' }} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Studio</h3>
              <p className="text-xs" style={{ color: 'rgba(160,120,60,0.7)' }}>{cachedTracks.length} tracks boosted</p>
            </div>
          </div>
          {/* VOYEX Araba TM badge — right corner, luxury shimmer */}
          <div className="flex items-center gap-3">
            <div
              className="relative overflow-hidden rounded-xl px-3 py-2"
              style={{
                background: 'linear-gradient(135deg, rgba(80,55,30,0.35), rgba(50,35,20,0.25))',
                border: '1px solid rgba(160,120,60,0.25)',
              }}
            >
              {/* Shimmer sweep — moves across, shifts the brown tint as it goes.
                  background-size: 300% ensures the gradient is wider than the
                  container so background-position animation creates visible movement. */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: 'linear-gradient(110deg, transparent 20%, rgba(200,165,100,0.18) 40%, rgba(170,130,70,0.10) 50%, transparent 70%)',
                  backgroundSize: '300% 100%',
                  animation: 'voyo-araba-shimmer 4s ease-in-out infinite',
                }}
              />
              <div className="relative flex flex-col items-end">
                <div className="flex items-baseline gap-1">
                  <span
                    className="text-[10px] font-black tracking-[0.15em]"
                    style={{
                      background: 'linear-gradient(135deg, #C4945A 0%, #A07840 40%, #7A5A30 70%, #5C4020 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text',
                    }}
                  >
                    VOYEX
                  </span>
                  <span
                    className="text-[10px] font-bold tracking-wide"
                    style={{
                      background: 'linear-gradient(135deg, #D4A868 0%, #B08548 50%, #8A6535 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text',
                    }}
                  >
                    Araba
                  </span>
                  <span className="text-[6px] align-super" style={{ color: 'rgba(160,120,60,0.6)' }}>TM</span>
                </div>
                <span
                  className="text-[7px] tracking-[0.25em] font-medium"
                  style={{
                    // "Excellence" in soft golden — the lightest, warmest tone
                    color: 'rgba(212,175,105,0.55)',
                  }}
                >
                  AFRICAN SOUND EXCELLENCE
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
            >
              <X size={18} className="text-gray-400" />
            </button>
          </div>
        </div>

        {/* Content - Scrollable */}
        <div className="px-6 pb-24 space-y-4 overflow-y-auto flex-1">
          {/* Audio Enhancement Preset — three brand-matching lucide icons.
              Lottie was rendering inconsistently; lucide ships with Vite,
              looks crisp at 22px, and matches the rest of the app. */}
          <div className="bg-white/5 rounded-2xl p-4">
            <div className="text-sm font-medium text-white mb-3">Audio Enhancement</div>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setBoostProfile('boosted')}
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-all voyo-tap-scale ${
                  boostProfile === 'boosted'
                    ? 'bg-gradient-to-br from-[#D4A053]/15 to-[#B17C2A]/10 border-[#D4A053]/35'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                <Flame
                  size={22}
                  strokeWidth={1.6}
                  style={{
                    color: boostProfile === 'boosted' ? '#E6B865' : 'rgba(212,160,83,0.55)',
                    filter: boostProfile === 'boosted' ? 'drop-shadow(0 0 6px rgba(212,160,83,0.7))' : 'none',
                  }}
                />
                <span
                  className="text-[11px] font-bold"
                  style={{ color: boostProfile === 'boosted' ? '#E6B865' : 'rgba(255,255,255,0.55)' }}
                >
                  True Feel
                </span>
                <span className="text-[9px] opacity-60 text-white">Roots Audio</span>
              </button>

              <button
                onClick={() => setBoostProfile('calm')}
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-all voyo-tap-scale relative overflow-hidden ${
                  boostProfile === 'calm'
                    ? 'bg-gradient-to-br from-[#1a2a3a]/40 to-[#0d1926]/25 border-[#5BA4CF]/30'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                {/* Swarovski blue shimmer — crystal sparkle on the Daily preset */}
                {boostProfile === 'calm' && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: 'linear-gradient(110deg, transparent 30%, rgba(91,164,207,0.12) 45%, rgba(130,200,240,0.06) 55%, transparent 70%)',
                      backgroundSize: '300% 100%',
                      animation: 'voyo-araba-shimmer 5s ease-in-out infinite',
                    }}
                  />
                )}
                <span
                  className="text-[11px] font-bold relative z-10"
                  style={{
                    color: boostProfile === 'calm' ? '#8EC8E8' : 'rgba(255,255,255,0.55)',
                    filter: boostProfile === 'calm' ? 'drop-shadow(0 0 4px rgba(91,164,207,0.5))' : 'none',
                  }}
                >
                  Flow
                </span>
                <span className="text-[9px] opacity-50 text-white relative z-10">Balanced</span>
              </button>

              <button
                onClick={() => setBoostProfile('voyex')}
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-all relative voyo-tap-scale ${
                  boostProfile === 'voyex'
                    ? 'bg-gradient-to-br from-[#8A6535]/18 to-[#5C4020]/10 border-[#C4945A]/35'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                <Sliders
                  size={22}
                  strokeWidth={1.6}
                  style={{
                    color: boostProfile === 'voyex' ? '#C4945A' : 'rgba(160,120,60,0.55)',
                    filter: boostProfile === 'voyex' ? 'drop-shadow(0 0 6px rgba(160,120,60,0.7))' : 'none',
                  }}
                />
                <span
                  className="text-[11px] font-bold"
                  style={{
                    background: boostProfile === 'voyex'
                      ? 'linear-gradient(135deg, #C4945A, #A07840)'
                      : 'none',
                    WebkitBackgroundClip: boostProfile === 'voyex' ? 'text' : undefined,
                    WebkitTextFillColor: boostProfile === 'voyex' ? 'transparent' : undefined,
                    backgroundClip: boostProfile === 'voyex' ? 'text' : undefined,
                    color: boostProfile === 'voyex' ? undefined : 'rgba(255,255,255,0.55)',
                  }}
                >
                  Studio
                </span>
                <span className="text-[9px] opacity-60 text-white">Araba</span>
              </button>
            </div>
            <div className="text-[10px] text-gray-500 mt-3 text-center">
              {boostProfile === 'boosted' && 'Roots™ Audio — True Feel'}
              {boostProfile === 'calm' && 'Perfectly Balanced · Daily enjoyment'}
              {boostProfile === 'voyex' && 'Studio energy — full immersion'}
            </div>
          </div>

          {/* VOYEX Spatial Slider */}
          {boostProfile === 'voyex' && (
            <div className="overflow-hidden animate-voyo-slide-up">
              <div className="bg-white/5 rounded-2xl p-4">
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={voyexSpatial}
                  onChange={(e) => setVoyexSpatial(Number(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #7c3aed, #8b5cf6 45%, #a78bfa 70%, #D4A053)`,
                  }}
                />
                <div className="flex justify-between mt-1.5">
                  <span className="text-[10px] text-purple-400/70 font-medium tracking-wider">DIV</span>
                  <span className="text-[10px] text-[#D4A053]/70 font-medium tracking-wider">IMM</span>
                </div>
              </div>
            </div>
          )}

          {/* Auto-Boost — the smart silent rule.
              No "Download When" choice anymore. Listen past the threshold,
              the track is marked Boosted (protected from cache eviction).
              Skip too fast, the track stays in scratch cache and gets
              evicted upstream by the LRU. You don't manage downloads —
              the AI manages them for you. */}
          <div className="bg-white/5 rounded-2xl p-4 relative overflow-hidden">
            {/* AI silver chip — top-right indicator that this is AI-driven */}
            <div
              className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[8px] font-black tracking-[0.2em]"
              style={{
                background: 'linear-gradient(135deg, rgba(220,220,230,0.18), rgba(170,175,190,0.10))',
                border: '1px solid rgba(220,220,230,0.22)',
                color: '#E0E2E8',
                textShadow: '0 0 6px rgba(220,220,230,0.4)',
                boxShadow: '0 0 10px rgba(220,220,230,0.08), inset 0 0 8px rgba(220,220,230,0.04)',
              }}
            >
              AI
            </div>

            <div className="flex items-center justify-between mb-3 pr-10">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  autoBoostEnabled ? '' : 'bg-white/5'
                }`}
                style={autoBoostEnabled ? {
                  background: 'linear-gradient(135deg, rgba(212,160,83,0.22), rgba(177,124,42,0.12))',
                  boxShadow: '0 0 12px rgba(212,160,83,0.25)',
                } : undefined}>
                  <Zap
                    size={16}
                    strokeWidth={2}
                    style={{
                      color: autoBoostEnabled ? '#E6B865' : 'rgba(255,255,255,0.35)',
                      filter: autoBoostEnabled ? 'drop-shadow(0 0 4px rgba(212,160,83,0.6))' : 'none',
                    }}
                  />
                </div>
                <div>
                  {/* "Boost" word gets the golden bronze treatment — same
                      tone as the cube ring + the bronze portal line. */}
                  <div className="text-sm font-medium">
                    <span className="text-white">Auto-</span>
                    <span
                      className="font-bold"
                      style={{
                        background: 'linear-gradient(135deg, #E6B865 0%, #D4A053 50%, #B17C2A 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        textShadow: '0 0 12px rgba(212,160,83,0.35)',
                      }}
                    >
                      Boost
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Download tracks you love as you go</div>
                  {autoBoostEnabled && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span
                        className="text-[8px] font-bold tracking-wider"
                        style={{ color: 'rgba(180,135,70,0.65)' }}
                      >
                        VOYEX<sup className="text-[5px]">TM</sup> enabled
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={() => {
                  haptics.light();
                  autoBoostEnabled ? disableAutoBoost() : enableAutoBoost();
                }}
                className="w-12 h-7 rounded-full transition-colors relative active:scale-95"
                aria-label={autoBoostEnabled ? 'Disable auto-boost' : 'Enable auto-boost'}
                style={{
                  background: autoBoostEnabled
                    ? 'linear-gradient(135deg, #D4A053, #B17C2A)'
                    : 'rgba(255,255,255,0.10)',
                  boxShadow: autoBoostEnabled ? '0 0 12px rgba(212,160,83,0.4)' : 'none',
                }}
              >
                <div
                  className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-md voyo-transition-all"
                  style={{ left: autoBoostEnabled ? 26 : 4 }}
                />
              </button>
            </div>
            <div className="text-[10px] text-gray-500">
              {manualBoostCount > 0
                ? `${manualBoostCount} ${manualBoostCount === 1 ? 'track' : 'tracks'} boosted manually`
                : 'Listen past a few seconds → kept for keeps'}
            </div>
          </div>

          {/* OYE Bar Behavior — the cards ARE the effect.
              No eye icons. The selected card has a subtle glow/animation
              that demonstrates the behavior. Neutral tones (no purple). */}
          <div className="bg-white/5 rounded-2xl p-4">
            <div className="text-sm font-medium text-white mb-3">OYE Bar</div>
            <div className="grid grid-cols-2 gap-2">
              {/* Fade option — card has a subtle opacity gradient to show "fading" */}
              <button
                onClick={() => { setOyeBarBehavior('fade'); haptics.light(); }}
                className={`relative flex flex-col items-center justify-center gap-1 p-3 rounded-xl border transition-all active:scale-95 overflow-hidden ${
                  oyeBarBehavior === 'fade'
                    ? 'bg-white/8 border-white/25 text-white'
                    : 'bg-white/[0.03] border-white/8 text-gray-500 hover:bg-white/5'
                }`}
              >
                {/* The "fade" effect visualized ON the card */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: oyeBarBehavior === 'fade'
                      ? 'linear-gradient(to bottom, rgba(255,255,255,0.06) 0%, transparent 60%)'
                      : 'none',
                  }}
                />
                <span className="text-[11px] font-semibold relative z-10">Fade</span>
                <span className="text-[8px] opacity-50 relative z-10">to DJ OYO's Space</span>
              </button>
              {/* Disappear option — card has a "vanishing" feel */}
              <button
                onClick={() => { setOyeBarBehavior('disappear'); haptics.light(); }}
                className={`relative flex flex-col items-center justify-center gap-1 p-3 rounded-xl border transition-all active:scale-95 overflow-hidden ${
                  oyeBarBehavior === 'disappear'
                    ? 'bg-white/8 border-white/25 text-white'
                    : 'bg-white/[0.03] border-white/8 text-gray-500 hover:bg-white/5'
                }`}
              >
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: oyeBarBehavior === 'disappear'
                      ? 'linear-gradient(to bottom, transparent 40%, rgba(255,255,255,0.04) 100%)'
                      : 'none',
                  }}
                />
                <span className="text-[11px] font-semibold relative z-10">Disappear</span>
                <span className="text-[8px] opacity-50 relative z-10">OYO's Space Direct</span>
              </button>
            </div>
          </div>

          {/* Sleep Timer */}
          <SleepTimerSection />

          {/* Storage Info */}
          <div className="bg-white/5 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <HardDrive size={18} className="text-gray-400" />
                <div>
                  <div className="text-sm font-medium text-white">Storage Used</div>
                  <div className="text-[10px] text-gray-500">{cachedTracks.length} tracks</div>
                </div>
              </div>
              <div className="text-lg font-bold text-white">{formatSize(cacheSize)}</div>
            </div>
            <div className="h-2 bg-white/10 rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-violet-600 voyo-bar-animate"
                style={{ width: `${Math.min(100, (cacheSize / (500 * 1024 * 1024)) * 100)}%` }}
              />
            </div>
            {cachedTracks.length > 0 && (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors voyo-tap-scale active:scale-[0.97]"
                style={{
                  background: 'linear-gradient(135deg, rgba(160,165,175,0.08), rgba(130,135,145,0.04))',
                  border: '1px solid rgba(160,165,175,0.15)',
                  color: 'rgba(180,185,195,0.75)',
                }}
              >
                <Trash2 size={14} />
                Clear All Boosted Tracks
              </button>
            )}
          </div>

          {/* Recent Boosted Tracks */}
          {cachedTracks.length > 0 && (
            <div className="bg-white/5 rounded-2xl p-4">
              <div className="text-sm font-medium text-white mb-3">Recently Boosted</div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {cachedTracks.slice(0, 5).map((track) => (
                  <button
                    key={track.id}
                    onClick={() => {
                      // Play the boosted track. Construct a minimal Track shape
                      // — playerStore handles the rest via the load pipeline
                      // and the local IndexedDB cache for instant playback.
                      usePlayerStore.getState().playTrack({
                        id: track.id,
                        trackId: track.id,
                        title: track.title,
                        artist: track.artist,
                        coverUrl: `https://i.ytimg.com/vi/${track.id}/hq720.jpg`,
                        duration: 0,
                        tags: [],
                        oyeScore: 0,
                        createdAt: new Date().toISOString(),
                      } as any);
                      onClose();
                    }}
                    className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg w-full text-left hover:bg-white/5 active:bg-white/10 transition-colors"
                  >
                    <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                      style={{ background: 'rgba(160,120,60,0.15)' }}
                    >
                      <Zap size={10} style={{ color: '#C4945A' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate">{track.title}</div>
                      <div className="text-[10px] text-gray-500 truncate">{track.artist}</div>
                    </div>
                    <div className="text-[10px] text-gray-500 flex-shrink-0">{formatSize(track.size)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Clear Confirm Dialog */}
        {/* Clear Confirm — Apple-style metallic dialog. No red anywhere.
            Destructive action indicated by weight (bold) not color. */}
        {showClearConfirm && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-6 animate-voyo-fade-in">
            <div
              className="rounded-2xl p-6 w-full max-w-xs animate-voyo-scale-in"
              style={{
                background: 'linear-gradient(145deg, rgba(38,38,44,0.98), rgba(28,28,34,0.98))',
                border: '1px solid rgba(160,165,175,0.12)',
                boxShadow: '0 24px 60px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)',
              }}
            >
              <div className="text-center mb-6">
                <div
                  className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, rgba(160,165,175,0.12), rgba(130,135,145,0.06))',
                    border: '1px solid rgba(160,165,175,0.15)',
                  }}
                >
                  <Trash2 size={20} style={{ color: 'rgba(180,185,195,0.7)' }} />
                </div>
                <h4 className="text-white font-bold mb-1">Clear All Boosted Tracks?</h4>
                <p className="text-xs" style={{ color: 'rgba(160,165,175,0.6)' }}>
                  This will remove {cachedTracks.length} tracks ({formatSize(cacheSize)}) from your device.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium active:scale-[0.97] transition-transform"
                  style={{
                    background: 'rgba(160,165,175,0.08)',
                    border: '1px solid rgba(160,165,175,0.12)',
                    color: 'rgba(200,205,215,0.8)',
                  }}
                  disabled={isClearing}
                >
                  Cancel
                </button>
                <button
                  onClick={handleClearCache}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold active:scale-[0.97] transition-transform"
                  style={{
                    background: 'linear-gradient(135deg, rgba(180,185,195,0.18), rgba(150,155,165,0.10))',
                    border: '1px solid rgba(180,185,195,0.22)',
                    color: 'rgba(230,233,240,0.95)',
                  }}
                  disabled={isClearing}
                >
                  {isClearing ? 'Clearing...' : 'Clear All'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Compact Boost Settings Button (for player UI)
 */
export const BoostSettingsButton = ({ onClick }: { onClick: () => void }) => (
  <button
    onClick={onClick}
    className="p-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors voyo-hover-scale voyo-tap-scale"
    title="Boost Settings"
  >
    <Settings size={14} className="text-gray-400" />
  </button>
);

export default BoostSettings;
