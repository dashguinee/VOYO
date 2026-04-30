/**
 * PiP Service — thin singleton that lets any component call enterPiP/exitPiP
 * without prop drilling. useMiniPiP (in AudioPlayer) registers its functions
 * here on mount; VoyoPortraitPlayer and others call these directly.
 *
 * v939 — also tracks active state so UI elements (e.g., the MiniPlayer
 * Takeout bubble) can render "PiP is active" without their own polling.
 * useMiniPiP calls setActive() on enter() success and on the
 * 'leavepictureinpicture' DOM event.
 */

type PiPEnterFn = () => Promise<boolean>;
type PiPExitFn = () => Promise<void>;
type PiPToggleFn = () => Promise<void>;
type ActiveListener = (active: boolean) => void;

let _enter: PiPEnterFn | null = null;
let _exit: PiPExitFn | null = null;
let _toggle: PiPToggleFn | null = null;
let _active = false;
const _activeListeners = new Set<ActiveListener>();

export const pipService = {
  register(enter: PiPEnterFn, exit: PiPExitFn, toggle: PiPToggleFn) {
    _enter = enter;
    _exit = exit;
    _toggle = toggle;
  },
  enter: () => (_enter ? _enter() : Promise.resolve(false)),
  exit: () => (_exit ? _exit() : Promise.resolve()),
  toggle: () => (_toggle ? _toggle() : Promise.resolve()),
  isRegistered: () => !!_enter,
  isActive: () => _active,
  setActive: (active: boolean) => {
    if (_active === active) return;
    _active = active;
    _activeListeners.forEach((fn) => { try { fn(active); } catch { /* swallow */ } });
  },
  subscribeActive: (fn: ActiveListener): (() => void) => {
    _activeListeners.add(fn);
    return () => { _activeListeners.delete(fn); };
  },
};
