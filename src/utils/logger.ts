/**
 * Development-only logger
 * All logs are stripped in production builds (tree-shaken)
 */

const isDev = import.meta.env.DEV;

export const devLog = isDev
  ? (...args: unknown[]) => console.log(...args)
  : () => {};

export const devWarn = isDev
  ? (...args: unknown[]) => console.warn(...args)
  : () => {};

export const devError = isDev
  ? (...args: unknown[]) => console.error(...args)
  : () => {};

// For critical errors that should always log
export const criticalError = (...args: unknown[]) => console.error(...args);
