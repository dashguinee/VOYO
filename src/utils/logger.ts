/**
 * Development-only logger
 * All logs are stripped in production builds (tree-shaken)
 * Uses .bind() for proper stack traces and zero-overhead no-ops
 */

export const devLog = import.meta.env.DEV ? console.log.bind(console) : () => {};
export const devWarn = import.meta.env.DEV ? console.warn.bind(console) : () => {};
export const devError = import.meta.env.DEV ? console.error.bind(console) : () => {};

// For critical errors that should always log
export const criticalError = console.error.bind(console);
