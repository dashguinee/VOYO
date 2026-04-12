/**
 * VOYO Push Notifications — subscribe to OYO's ambient notifications.
 *
 * OYO sends notifications like:
 *   • "Up next: Burna Boy — Last Last" (pre-announce next track)
 *   • "This is a special one ✨" (context about the current track)
 *   • "Your vibe is shifting toward Amapiano tonight" (taste insight)
 *   • "3 friends are listening right now" (social presence)
 *
 * Uses the same VAPID keys + Supabase dash_push_tokens table as Giraf.
 * Different app tag ('voyo' vs 'giraf') so tokens don't mix.
 *
 * Ported from GirafThePillow/app/src/hooks/usePushNotifications.ts
 */

import { useRef, useState, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { devLog, devWarn } from '../utils/logger';

const VAPID_PUBLIC_KEY = 'BCyj-APsdQcUR9qo7rnUNJ05LOCBKhv3wO2RQuX7Ws4jbYRkqrqc5jDMLe8mrfqmwdMs_XcWqUdZfjNTOO2Zjhg';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function generateDeviceId(endpoint: string): string {
  let hash = 0;
  for (let i = 0; i < endpoint.length; i++) {
    hash = ((hash << 5) - hash + endpoint.charCodeAt(i)) | 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `00000000-0000-4000-8000-${hex.padStart(12, '0')}`;
}

export function usePushNotifications() {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const checkedRef = useRef(false);

  const supported = typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && isSupabaseConfigured;

  // Check subscription status on first call
  if (supported && !checkedRef.current) {
    checkedRef.current = true;
    navigator.serviceWorker.ready.then(reg => {
      reg.pushManager.getSubscription().then(sub => {
        setIsSubscribed(!!sub);
      });
    });
  }

  const prompted = typeof localStorage !== 'undefined'
    && localStorage.getItem('voyo-push-prompted') === 'true';

  const subscribe = useCallback(async (): Promise<'success' | 'denied' | 'failed'> => {
    if (!supported) return 'failed';

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });

      const tokenOwner = generateDeviceId(subscription.endpoint);

      if (supabase) {
        const { error } = await supabase.from('dash_push_tokens').upsert(
          {
            user_id: tokenOwner,
            app: 'voyo',
            subscription: subscription.toJSON(),
          },
          { onConflict: 'subscription' }
        );

        if (error) {
          devWarn('[VOYO Push] Token save failed:', error.message);
          return 'failed';
        }
      }

      // Welcome notification — direct from service worker
      registration.showNotification('OYO is here 🎵', {
        body: 'Your music, your DJ. Vibes incoming.',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'voyo-welcome',
      });

      setIsSubscribed(true);
      devLog('[VOYO Push] Subscribed successfully');
      return 'success';
    } catch (err) {
      devWarn('[VOYO Push] Subscription failed:', err);
      return 'failed';
    }
  }, [supported]);

  const dismiss = useCallback(() => {
    try { localStorage.setItem('voyo-push-prompted', 'true'); } catch {}
  }, []);

  return { supported, isSubscribed, prompted, subscribe, dismiss };
}
