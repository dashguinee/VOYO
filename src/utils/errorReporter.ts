/**
 * Window-level error capture → telemetry.
 *
 * React's error boundaries only catch render errors. Async errors thrown
 * outside the React tree (uncaught promise rejections, sync throws in
 * event handlers, errors inside non-React modules) go to /dev/null.
 * This bridges them to the existing telemetry pipeline so they show up
 * in voyo_playback_events as event_type='trace' subtype='window_error'
 * or 'unhandled_rejection'.
 *
 * Mounted once from main.tsx before React renders. Idempotent — safe
 * against HMR re-execution via the module-level `installed` flag.
 */

import { trace } from '../services/telemetry';

let installed = false;

const stripStack = (s: unknown): string | undefined => {
  if (typeof s !== 'string') return undefined;
  return s.slice(0, 600);
};

const stripMsg = (s: unknown): string => {
  try {
    if (typeof s === 'string') return s.slice(0, 200);
    if (s && typeof s === 'object' && 'message' in s) return String((s as Error).message).slice(0, 200);
    return String(s).slice(0, 200);
  } catch {
    return 'unparseable';
  }
};

export function installErrorReporter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e) => {
    try {
      trace('window_error', null, {
        msg: stripMsg(e.message || e.error),
        src: typeof e.filename === 'string' ? e.filename.slice(-120) : undefined,
        line: e.lineno,
        col: e.colno,
        stack: stripStack(e.error?.stack),
        hidden: document.hidden,
      });
    } catch { /* never block the host page */ }
  });

  window.addEventListener('unhandledrejection', (e) => {
    try {
      const reason = e.reason;
      trace('unhandled_rejection', null, {
        msg: stripMsg(reason),
        name: reason && typeof reason === 'object' && 'name' in reason ? String((reason as Error).name).slice(0, 60) : undefined,
        stack: stripStack(reason?.stack),
        hidden: document.hidden,
      });
    } catch { /* never block the host page */ }
  });
}
