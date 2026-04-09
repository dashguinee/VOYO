/**
 * VOYO Push Notifications Hook
 *
 * Same pattern as Giraf but:
 * - Uses `dash_push_tokens` table (unified across DASH apps)
 * - Tags tokens with `app: 'voyo'`
 * - Uses Command Center Supabase (where the table lives)
 * - Falls back to device ID if user is not authenticated
 */

import { useState, useEffect, useCallback } from 'react'
import { commandCenter } from '../lib/voyo-api'
import { getDashSession } from '../lib/dash-auth'

const VAPID_KEY_RAW = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''

// Convert base64 VAPID key to Uint8Array for PushManager
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

// Generate a stable device ID from the subscription endpoint
function deviceId(endpoint: string): string {
  let hash = 0
  for (let i = 0; i < endpoint.length; i++) {
    hash = ((hash << 5) - hash + endpoint.charCodeAt(i)) | 0
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0')
  return `00000000-0000-4000-8000-${hex.padStart(12, '0')}`
}

export function usePushNotifications() {
  const [isSubscribed, setIsSubscribed] = useState(false)

  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && !!VAPID_KEY_RAW && !!commandCenter

  const prompted = localStorage.getItem('voyo-push-prompted') === 'true'

  // Check current subscription status on mount
  useEffect(() => {
    if (!supported) return

    navigator.serviceWorker.ready.then(async (registration) => {
      const sub = await registration.pushManager.getSubscription()
      setIsSubscribed(!!sub)
    })
  }, [supported])

  const subscribe = useCallback(async (): Promise<'success' | 'denied' | 'failed'> => {
    if (!supported || !commandCenter) return 'failed'

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_KEY_RAW).buffer as ArrayBuffer,
      })

      // Use DASH ID if logged in, otherwise generate a device ID
      const session = getDashSession()
      const tokenOwner = session?.user?.core_id || deviceId(subscription.endpoint)

      const { error } = await commandCenter.from('dash_push_tokens').upsert(
        {
          user_id: tokenOwner,
          subscription: subscription.toJSON(),
          app: 'voyo',
        },
        { onConflict: 'subscription' }
      )

      if (error) {
        console.warn('[VOYO] Token save failed:', error.message)
        return 'failed'
      }

      // Welcome notification -- direct from service worker (instant, this device only)
      registration.showNotification('Welcome to VOYO \uD83C\uDFB5', {
        body: 'Your music, your vibe.',
        icon: '/icons/voyo-192.svg',
        badge: '/icons/voyo-192.svg',
        tag: 'voyo-welcome',
      })

      setIsSubscribed(true)
      return 'success'
    } catch (err) {
      console.warn('[VOYO] Push subscription failed:', err)
      return 'failed'
    }
  }, [supported])

  const dismiss = useCallback(() => {
    localStorage.setItem('voyo-push-prompted', 'true')
  }, [])

  return {
    supported,
    isSubscribed,
    prompted,
    subscribe,
    dismiss,
  }
}
