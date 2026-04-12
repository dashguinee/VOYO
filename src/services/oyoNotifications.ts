/**
 * OYO Notification System — ambient, non-cringe music notifications.
 *
 * OYO sends notifications at key moments:
 *   • NEXT UP: "Burna Boy — Last Last" (pre-announce, before crossfade)
 *   • CONTEXT: "This is a special one ✨" (a few seconds into a great track)
 *   • INSIGHT: "Your vibe shifted to Amapiano tonight" (taste learning)
 *   • SOCIAL: "3 friends vibing right now" (presence)
 *   • MILESTONE: "You've listened for 2 hours — sleep timer?" (care)
 *
 * Notifications are conversational — users can reply, and OYO takes action.
 * They fire via the browser's Notification API (in-app) or Push API (background).
 *
 * For Hub + VOYO: same Supabase table (dash_notifications), different app tags.
 */

import { devLog } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface OyoNotification {
  title: string;
  body: string;
  tag: string;         // Dedup key — same tag replaces previous
  icon?: string;
  url?: string;        // Deep link on tap
  actions?: Array<{ action: string; title: string }>;
  silent?: boolean;    // No sound (ambient mode)
}

// ============================================================================
// In-app notification (foreground — uses Notification API directly)
// ============================================================================

export function showInAppNotification(notif: OyoNotification): void {
  if (Notification.permission !== 'granted') return;

  try {
    const reg = navigator.serviceWorker?.controller;
    if (reg) {
      // Use service worker for rich notifications (actions, badge)
      navigator.serviceWorker.ready.then(registration => {
        const opts: Record<string, unknown> = {
          body: notif.body,
          icon: notif.icon || '/icon-192.png',
          badge: '/icon-192.png',
          tag: notif.tag,
          data: { url: notif.url || '/' },
          silent: notif.silent ?? true,
        };
        if (notif.actions) opts.actions = notif.actions;
        registration.showNotification(notif.title, opts as NotificationOptions);
      });
    } else {
      // Fallback: basic Notification API
      new Notification(notif.title, {
        body: notif.body,
        icon: notif.icon || '/icon-192.png',
        tag: notif.tag,
        silent: notif.silent ?? true,
      });
    }
    devLog(`[OYO Notif] ${notif.tag}: ${notif.title}`);
  } catch (e) {
    // Notifications not available — silent fail
  }
}

// ============================================================================
// OYO ambient notification triggers — called from playback events
// ============================================================================

let lastNotifTime = 0;
const MIN_INTERVAL = 30000; // 30s between notifications (non-cringe)

function shouldNotify(): boolean {
  const now = Date.now();
  if (now - lastNotifTime < MIN_INTERVAL) return false;
  if (document.hidden) return false; // Don't spam when backgrounded
  lastNotifTime = now;
  return true;
}

/** Pre-announce the next track (fires from nextTrack or crossfade) */
export function notifyNextUp(title: string, artist: string): void {
  if (!shouldNotify()) return;
  showInAppNotification({
    title: `Next up`,
    body: `${title} — ${artist}`,
    tag: 'oyo-next-up',
    silent: true,
  });
}

/** Context about the current track (fires ~10s into a special track) */
export function notifyTrackContext(message: string): void {
  if (!shouldNotify()) return;
  showInAppNotification({
    title: 'OYO',
    body: message,
    tag: 'oyo-context',
    silent: true,
  });
}

/** Taste insight (fires after significant listening patterns) */
export function notifyInsight(message: string): void {
  showInAppNotification({
    title: 'OYO noticed',
    body: message,
    tag: 'oyo-insight',
    silent: true,
  });
}

/** Social presence (fires when friends are active) */
export function notifySocial(count: number): void {
  if (!shouldNotify()) return;
  showInAppNotification({
    title: 'VOYO',
    body: `${count} ${count === 1 ? 'friend is' : 'friends are'} vibing right now`,
    tag: 'oyo-social',
    silent: true,
  });
}

/** Listening milestone (fires at 1h, 2h intervals) */
export function notifyMilestone(hours: number): void {
  showInAppNotification({
    title: 'OYO',
    body: hours === 1
      ? `1 hour of vibes. Want a sleep timer?`
      : `${hours} hours deep. Take a break?`,
    tag: 'oyo-milestone',
    silent: false, // This one should be audible
    actions: [
      { action: 'sleep-30', title: 'Sleep 30m' },
      { action: 'continue', title: 'Keep going' },
    ],
  });
}
