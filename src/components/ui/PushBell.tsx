/**
 * PushBell — opt-in chip for first-class Web Push.
 *
 * Defensive by design: a render failure here must NEVER crash the
 * surrounding app tree. On any unexpected throw the component hides
 * itself and logs quietly.
 */

import { Component, type ReactNode, useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { usePushSubscribe } from '../../hooks/usePushSubscribe';
import { devWarn } from '../../utils/logger';

// Reveal choreography — keeps the alerts chip from competing with
// cover-art + track info on first load:
//
//   t=0     mount  → opacity 0 (held)
//   t=3000  reveal → fade in to 100% over 600ms
//   t=4500  pulse  → slow breath (1s cycle) for 3s
//   t=7500  idle   → settle to 80% opacity, stay there
type RevealPhase = 'hidden' | 'revealing' | 'pulsing' | 'idle';

interface Props {
  appCode?: 'voyo' | 'hub' | 'tivi' | 'giraf' | string;
}

function PushBellInner({ appCode = 'voyo' }: Props) {
  const { dashId } = useAuth();
  const { supported, permission, isSubscribed, isBusy, request } = usePushSubscribe(appCode);
  const [hidden, setHidden] = useState(false);
  const [phase, setPhase] = useState<RevealPhase>('hidden');

  // Reveal timeline — 3s delay → 600ms fade → 1.5s rest → 3s pulse → 80%.
  useEffect(() => {
    const t1 = setTimeout(() => setPhase('revealing'), 3000);
    const t2 = setTimeout(() => setPhase('pulsing'), 4500);
    const t3 = setTimeout(() => setPhase('idle'), 7500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  if (hidden) return null;
  if (!supported) return null;
  if (permission === 'denied') return null;
  if (isSubscribed) return null;
  if (!dashId) return null;

  const targetOpacity = phase === 'hidden' ? 0 : phase === 'idle' ? 0.8 : 1;

  return (
    <button
      onClick={async () => {
        try {
          const res = await request();
          if (res !== 'success') setHidden(true);
        } catch (e) {
          devWarn('[PushBell] request failed:', e);
          setHidden(true);
        }
      }}
      disabled={isBusy}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/15 border border-purple-500/30 text-[10px] text-purple-200 backdrop-blur-md hover:bg-purple-500/25 transition-colors"
      title="Turn on push notifications"
      style={{
        opacity: targetOpacity,
        transition: 'opacity 600ms cubic-bezier(0.16, 1, 0.3, 1)',
        animation: phase === 'pulsing' ? 'pushbell-pulse 1s ease-in-out infinite' : 'none',
        pointerEvents: phase === 'hidden' ? 'none' : 'auto',
      }}
      aria-hidden={phase === 'hidden'}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      <span>{isBusy ? 'Enabling…' : 'Turn on alerts'}</span>
      <style>{`
        @keyframes pushbell-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.7; transform: scale(1.035); }
        }
      `}</style>
    </button>
  );
}

// Hard boundary: anything the inner hook/component throws is swallowed
// here so the top-level AppErrorBoundary never sees it.
class PushBellBoundary extends Component<{ children: ReactNode }, { dead: boolean }> {
  state = { dead: false };
  static getDerivedStateFromError(): { dead: boolean } { return { dead: true }; }
  componentDidCatch(error: Error) { devWarn('[PushBell] render crash:', error); }
  render() { return this.state.dead ? null : this.props.children; }
}

export function PushBell(props: Props) {
  return (
    <PushBellBoundary>
      <PushBellInner {...props} />
    </PushBellBoundary>
  );
}
