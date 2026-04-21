/**
 * PushBell — tiny opt-in affordance for first-class Web Push.
 * Hidden when already subscribed, unsupported, denied, or not signed in.
 */

import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { usePushSubscribe } from '../../hooks/usePushSubscribe';

interface Props {
  appCode?: 'voyo' | 'hub' | 'tivi' | 'giraf' | string;
}

export function PushBell({ appCode = 'voyo' }: Props) {
  const { dashId } = useAuth();
  const { supported, permission, isSubscribed, isBusy, request } = usePushSubscribe(appCode);
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;
  if (!supported) return null;
  if (permission === 'denied') return null;
  if (isSubscribed) return null;
  if (!dashId) return null;

  return (
    <button
      onClick={async () => {
        const res = await request();
        if (res !== 'success') setHidden(true);
      }}
      disabled={isBusy}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/15 border border-purple-500/30 text-[10px] text-purple-200 backdrop-blur-md hover:bg-purple-500/25 transition-colors"
      title="Turn on push notifications"
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      <span>{isBusy ? 'Enabling…' : 'Turn on alerts'}</span>
    </button>
  );
}
