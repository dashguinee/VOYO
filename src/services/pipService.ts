/**
 * PiP Service — thin singleton that lets any component call enterPiP/exitPiP
 * without prop drilling. useMiniPiP (in AudioPlayer) registers its functions
 * here on mount; VoyoPortraitPlayer and others call these directly.
 */

type PiPEnterFn = () => Promise<boolean>;
type PiPExitFn = () => Promise<void>;
type PiPToggleFn = () => Promise<void>;

let _enter: PiPEnterFn | null = null;
let _exit: PiPExitFn | null = null;
let _toggle: PiPToggleFn | null = null;

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
};
