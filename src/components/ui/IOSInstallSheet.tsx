import type { Platform } from '../../hooks/usePWA';

interface Props {
  open: boolean;
  onClose: () => void;
  platform: Platform;
}

/**
 * Instructions sheet shown when the browser can't programmatically trigger
 * install. iOS Safari has no beforeinstallprompt — user must use the native
 * Share sheet. Android Chrome sometimes suppresses the event too (WebAPK
 * shadow-installed, dismissed recently) — same fallback applies via the
 * browser menu.
 */
export function IOSInstallSheet({ open, onClose, platform }: Props) {
  if (!open) return null;

  const isIOS = platform === 'ios';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center animate-voyo-fade-in-delayed"
      style={{ background: 'rgba(5,5,8,0.72)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl p-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"
        style={{
          background: 'linear-gradient(180deg, #151522 0%, #0a0a12 100%)',
          border: '1px solid rgba(139,92,246,0.25)',
          boxShadow: '0 -8px 40px rgba(139,92,246,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-lg font-semibold"
            style={{
              background: 'linear-gradient(90deg, #8b5cf6, #a78bfa)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Install VOYO on your Home Screen
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-white/40 hover:text-white/80 text-2xl leading-none voyo-tap-scale"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-white/60 mb-5">
          {isIOS
            ? 'Safari needs a manual step — takes 5 seconds:'
            : 'Your browser needs the menu — takes 5 seconds:'}
        </p>

        <ol className="space-y-4 text-sm text-white/85">
          {isIOS ? (
            <>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.25)', color: '#c4b5fd' }}>1</span>
                <span>
                  Tap the <strong>Share</strong> icon
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="inline mx-1 -mt-0.5">
                    <path d="M12 3v12m0-12l-4 4m4-4l4 4M5 12v6a2 2 0 002 2h10a2 2 0 002-2v-6" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  at the bottom of Safari.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.25)', color: '#c4b5fd' }}>2</span>
                <span>Scroll and tap <strong>Add to Home Screen</strong>.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.25)', color: '#c4b5fd' }}>3</span>
                <span>Tap <strong>Add</strong> in the top-right.</span>
              </li>
            </>
          ) : (
            <>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.25)', color: '#c4b5fd' }}>1</span>
                <span>Open the browser menu (<strong>⋮</strong> top-right).</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.25)', color: '#c4b5fd' }}>2</span>
                <span>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.25)', color: '#c4b5fd' }}>3</span>
                <span>Confirm <strong>Install</strong>.</span>
              </li>
            </>
          )}
        </ol>

        <button
          onClick={onClose}
          className="mt-6 w-full py-3 rounded-xl text-sm font-medium voyo-tap-scale"
          style={{
            background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
            color: '#fff',
            boxShadow: '0 4px 20px rgba(139,92,246,0.3)',
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
