import { Zap } from 'lucide-react';
import { useBackGuard } from '../../hooks/useBackGuard';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * DiscoExplainer — the "what is Disco" moment, on tap.
 *
 * Premium centred card. Bronze aesthetic. Three beats:
 *   1. What Disco is (instant, offline, lockscreen-proof).
 *   2. How to put something IN the disco (tap Oye, we cook).
 *   3. Done.
 *
 * Dismiss by tapping outside, the ×, or the "Got it" CTA. No
 * pagination, no tutorial mode — the whole thing reads in 3 seconds.
 */
export function DiscoExplainer({ open, onClose }: Props) {
  // Back gesture closes the explainer. When opened from inside search,
  // the search overlay's own guard (named differently) stays put so one
  // back press peels the explainer off, second back press peels search.
  useBackGuard(open, onClose, 'disco-explainer');
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-4 animate-voyo-fade-in-delayed"
      style={{
        background: 'rgba(5, 5, 8, 0.72)',
        backdropFilter: 'blur(10px) saturate(130%)',
        WebkitBackdropFilter: 'blur(10px) saturate(130%)',
      }}
      onClick={onClose}
    >
      <div
        className="relative max-w-sm w-full rounded-2xl p-6 pt-7"
        style={{
          background: 'linear-gradient(180deg, rgba(22,16,8,0.96) 0%, rgba(12,8,4,0.97) 100%)',
          border: '1px solid rgba(212,175,110,0.28)',
          boxShadow: '0 30px 80px -24px rgba(0,0,0,0.85), 0 0 28px rgba(212,175,110,0.10) inset',
          animation: 'voyo-disco-explainer-enter 480ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Corner flourish — small bronze triangle, same language as
            StationHero's upper-left accent. Quiet signature. */}
        <div
          aria-hidden="true"
          className="absolute top-0 left-0 pointer-events-none"
          style={{
            width: 44,
            height: 44,
            background: 'linear-gradient(135deg, rgba(212,175,110,0.40) 0%, transparent 62%)',
            clipPath: 'polygon(0 0, 100% 0, 0 100%)',
            borderTopLeftRadius: 16,
          }}
        />

        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-white/35 hover:text-white/85 text-xl leading-none voyo-tap-scale"
        >
          ×
        </button>

        {/* Title — bronze shimmer text matching the Library's "My Disco"
            heading. Keeps the word "Disco" feeling consistent wherever it
            appears. */}
        <h2
          className="text-[26px] font-bold leading-tight tracking-tight mb-3"
          style={{
            fontFamily: "'Satoshi', sans-serif",
            background:
              'linear-gradient(90deg, #8B6228 0%, #C4943D 18%, #E6B865 35%, #FFF3D6 50%, #E6B865 65%, #C4943D 82%, #8B6228 100%)',
            backgroundSize: '240% 100%',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 14px rgba(212,160,83,0.22))',
          }}
        >
          Your Disco
        </h2>

        {/* Hairline bronze underline flourish — same as GreetingBanner.
            Ties the explainer visually to the daily greeting so the two
            golden moments feel like they come from one place. */}
        <div
          aria-hidden="true"
          className="h-[1.5px] mb-5 rounded-full"
          style={{
            width: '40%',
            background:
              'linear-gradient(90deg, rgba(212,160,83,0.85) 0%, rgba(230,184,101,0.5) 50%, rgba(212,160,83,0.08) 100%)',
          }}
        />

        <div className="space-y-3.5 text-[14px] text-white/80 leading-relaxed">
          <p>
            Tracks in your Disco <span className="text-white font-medium">play instantly</span> —
            background, offline, lockscreen. No loading.
          </p>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
            <span>Not in your Disco yet? Tap</span>
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-semibold"
              style={{
                background: 'rgba(212,160,83,0.14)',
                border: '1px solid rgba(212,160,83,0.38)',
                color: 'rgba(232,208,158,0.98)',
              }}
            >
              <Zap size={12} strokeWidth={2.4} />
              Oye
            </span>
            <span>— we cook it. It'll play right up.</span>
          </p>
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full py-3 rounded-xl text-[14px] font-semibold voyo-tap-scale"
          style={{
            color: '#1b1b22',
            background:
              'linear-gradient(135deg, #E6B865 0%, #D4A053 50%, #C4943D 100%)',
            boxShadow:
              '0 8px 24px -6px rgba(212,175,110,0.55), inset 0 1px 0 rgba(255,255,255,0.35)',
            letterSpacing: '0.01em',
          }}
        >
          Got it
        </button>
      </div>

      <style>{`
        @keyframes voyo-disco-explainer-enter {
          from { opacity: 0; transform: scale(0.94) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
