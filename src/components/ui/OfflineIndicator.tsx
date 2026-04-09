/**
 * VOYO Music - Offline Mode Indicator
 * Shows when user loses network connectivity
 */

import { useEffect, useState, useRef } from 'react';
import { WifiOff, Wifi } from 'lucide-react';

export const OfflineIndicator = () => {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showReconnected, setShowReconnected] = useState(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      setShowReconnected(true);
      // Clear previous timeout and set new one
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => setShowReconnected(false), 3000);
    };

    const handleOffline = () => {
      setIsOffline(true);
      setShowReconnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, []);

  return (
    <>
      {isOffline && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[100] bg-white/20 text-white px-4 py-2 rounded-full shadow-lg shadow-white/10 backdrop-blur-md flex items-center gap-2 animate-voyo-slide-down border border-white/20"
          style={{ top: 'max(16px, env(safe-area-inset-top, 16px))' }}
        >
          <WifiOff size={14} aria-hidden="true" />
          <span className="text-xs font-bold" role="status">Offline Mode</span>
        </div>
      )}

      {showReconnected && !isOffline && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[100] bg-purple-500 text-white px-4 py-2 rounded-full shadow-lg shadow-purple-500/30 flex items-center gap-2 animate-voyo-slide-down"
          style={{ top: 'max(16px, env(safe-area-inset-top, 16px))' }}
        >
          <Wifi size={14} aria-hidden="true" />
          <span className="text-xs font-bold" role="status">Back Online</span>
        </div>
      )}
    </>
  );
};

export default OfflineIndicator;
