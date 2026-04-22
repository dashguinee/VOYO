/**
 * Shared coordination between the two install surfaces (banner + pill).
 *
 * Wave E3 decision: the banner is the primary install moment (v387's
 * intent). The pill is the persistent fallback, only allowed to render
 * AFTER the banner has been shown AND dismissed, OR when the banner is
 * permanently suppressed (seen this session / dismiss cooldown active /
 * user has already engaged via another path).
 *
 * Likewise `pwa_install_shown` fires ONCE per session — whichever surface
 * renders first claims it. The pill-as-fallback doesn't re-log shown if
 * the banner already did.
 */

type Phase = 'pending' | 'banner-visible' | 'resolved';

type Listener = () => void;

let phase: Phase = 'pending';
let shownLogged = false;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

export function getInstallSurfacePhase(): Phase {
  return phase;
}

export function hasShownBeenLogged(): boolean {
  return shownLogged;
}

export function markShownLogged() {
  shownLogged = true;
}

/**
 * Banner calls this the moment it becomes visible. Pill watches and hides.
 */
export function bannerBecameVisible() {
  phase = 'banner-visible';
  emit();
}

/**
 * Banner calls this when it goes away (dismissed, auto-hidden, or never
 * shown because cooldown/session-seen). Pill may render now.
 */
export function bannerResolved() {
  phase = 'resolved';
  emit();
}

/**
 * Called on a fresh mount where the banner won't run (e.g. banner
 * cooldown active, already seen this session, or banner component not
 * mounted). Lets the pill come up immediately.
 */
export function bannerSkipped() {
  if (phase === 'pending') {
    phase = 'resolved';
    emit();
  }
}

/** Subscribe to phase changes. Returns unsubscribe. */
export function subscribeInstallSurface(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Reset helper — test-only. Not exported via the barrel; reachable
 * through the module path in vitest.
 */
export function __resetInstallSurface() {
  phase = 'pending';
  shownLogged = false;
  listeners.clear();
}
