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
 * Rate rules:
 *   • Max 1 every 45 minutes
 *   • Max 4 stacked in the OS drawer before user returns to the app
 *   • Stack counter resets when user brings the app to foreground
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
// Rate limiting
// ============================================================================

const MIN_INTERVAL_MS = 45 * 60 * 1000; // 45 minutes between notifications
const MAX_STACK = 4;                      // Max pending in OS drawer at once

let _lastNotifTime = 0;
let _stackCount = 0;

// Reset stack count when user returns to the app — they likely cleared
// the OS notifications while away, so the budget refills.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) _stackCount = 0;
  });
}

function shouldNotify(): boolean {
  const now = Date.now();
  if (now - _lastNotifTime < MIN_INTERVAL_MS) return false;
  if (_stackCount >= MAX_STACK) return false;
  _lastNotifTime = now;
  _stackCount++;
  return true;
}

// ============================================================================
// In-app notification (foreground — uses SW showNotification for OS-level)
// ============================================================================

export function showInAppNotification(notif: OyoNotification): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  try {
    const opts: Record<string, unknown> = {
      body: notif.body,
      icon: notif.icon || '/icon-192.png',
      badge: '/icon-192.png',
      tag: notif.tag,
      data: { url: notif.url || '/' },
      silent: notif.silent ?? true,
      renotify: false,
    };
    if (notif.actions) opts.actions = notif.actions;

    // Prefer SW path — fires OS-level notification whether foregrounded or not.
    // Direct new Notification() is silent when the SW is active and the page
    // is hidden (Chrome silently drops it). SW showNotification works in both.
    navigator.serviceWorker.ready.then(registration => {
      registration.showNotification(notif.title, opts as NotificationOptions);
    });

    devLog(`[OYO Notif] ${notif.tag}: ${notif.title}`);
  } catch (e) {
    // Notifications not available — silent fail
  }
}

// ============================================================================
// OYO ambient notification triggers — called from playback events
// ============================================================================

/** Pre-announce the next track (fires from nextTrack or crossfade) */
export function notifyNextUp(title: string, artist: string): void {
  if (!shouldNotify()) return;
  showInAppNotification({
    title: 'Next up',
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
  if (!shouldNotify()) return;
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
  if (!shouldNotify()) return;
  showInAppNotification({
    title: 'OYO',
    body: hours === 1
      ? `1 hour of vibes. Want a sleep timer?`
      : `${hours} hours deep. Take a break?`,
    tag: 'oyo-milestone',
    silent: false,
    actions: [
      { action: 'sleep-30', title: 'Sleep 30m' },
      { action: 'continue', title: 'Keep going' },
    ],
  });
}
