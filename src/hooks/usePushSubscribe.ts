/**
 * usePushSubscribe — opt into first-class Web Push on voyo.
 *
 * Mirrors Hub's usePushNotifications pattern:
 *   - Subscribes via PushManager with VAPID public key.
 *   - Upserts the whole sub.toJSON() as jsonb into dash_push_tokens.
 *   - Welcomes on success with a SW-level local notification so the
 *     user sees the OS surface immediately (confirms it works).
 *
 * Call request() from a user gesture.
 */

import { useCallback, useEffect, useState } from 'react';
import { ccSupabase } from '../lib/dahub/dahub-api';
import { useAuth } from './useAuth';
import { devLog, devWarn } from '../utils/logger';

const VAPID_KEY_RAW = ((import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) || '').trim();

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function deviceId(endpoint: string): string {
  let hash = 0;
  for (let i = 0; i < endpoint.length; i++) {
    hash = ((hash << 5) - hash + endpoint.charCodeAt(i)) | 0;
  }
  return 'device-' + Math.abs(hash).toString(16).padStart(8, '0');
}

export type PushPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export function usePushSubscribe(appCode: 'voyo' | 'hub' | 'tivi' | 'giraf' | string = 'voyo') {
  const { dashId } = useAuth();

  const supported = typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
    && !!VAPID_KEY_RAW;

  const [permission, setPermission] = useState<PushPermission>(
    supported ? (Notification.permission as PushPermission) : 'unsupported'
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      if (!cancelled) setIsSubscribed(!!sub);
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [supported]);

  const request = useCallback(async (): Promise<'success' | 'denied' | 'failed'> => {
    if (!supported) { setLastError('Push not supported here'); return 'failed'; }
    setIsBusy(true);
    setLastError(null);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PushPermission);
      if (perm !== 'granted') { setLastError('Permission denied'); return 'denied'; }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_KEY_RAW).buffer as ArrayBuffer,
        });
      }

      const tokenOwner = dashId || deviceId(sub.endpoint);

      const { error } = await ccSupabase.from('dash_push_tokens').upsert(
        {
          user_id: tokenOwner,
          app: appCode,
          subscription: sub.toJSON(),
          tags: [],
        },
        { onConflict: 'subscription' }
      );
      if (error) {
        devWarn('[Push] token upsert failed:', error.message);
        setLastError(error.message);
        return 'failed';
      }

      // Confirm to the user the OS channel works — this fires from the SW
      // directly so they see a real native notification right away.
      try {
        reg.showNotification('Alerts enabled', {
          body: 'You\'ll get new-message and drop notifications here.',
          icon: '/icon-192.png',
          tag: 'voyo-welcome',
        });
      } catch { /* noop */ }

      setIsSubscribed(true);
      devLog('[Push] subscribed', { appCode, tokenOwner });
      return 'success';
    } catch (e: any) {
      devWarn('[Push] subscribe exception:', e);
      setLastError(e?.message || 'Subscribe failed');
      return 'failed';
    } finally {
      setIsBusy(false);
    }
  }, [dashId, appCode, supported]);

  const revoke = useCallback(async (): Promise<boolean> => {
    if (!supported) return false;
    setIsBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Delete by matching the subscription jsonb (endpoint is unique within it)
        await ccSupabase.from('dash_push_tokens')
          .delete()
          .eq('subscription->>endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
      setIsSubscribed(false);
      return true;
    } catch (e: any) {
      setLastError(e?.message || 'Unsubscribe failed');
      return false;
    } finally {
      setIsBusy(false);
    }
  }, [supported]);

  return { supported, permission, isSubscribed, isBusy, lastError, request, revoke };
}
