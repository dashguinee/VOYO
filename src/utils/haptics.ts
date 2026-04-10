/**
 * VOYO Music - Haptic Feedback System
 * Premium iOS-style haptic feedback for mobile interactions.
 *
 * April 2026 tuning: global 120ms cooldown between fires + softer
 * durations across the board. The old TikTok-level frequency was "too
 * much" per Dash — premium apps space out haptics so each tap feels
 * intentional, not noisy. Call sites stay unchanged; the throttle is
 * enforced here so one edit tones the whole app down.
 */

type HapticPattern = number | number[];

// Check if vibration API is supported
const canVibrate = (): boolean => {
  return typeof navigator !== 'undefined' && 'vibrate' in navigator;
};

// Global throttle — prevents rapid-fire haptics from multiple handlers
// colliding on the same gesture (e.g., pointerdown + click + double-tap).
const HAPTIC_COOLDOWN_MS = 120;
let lastHapticAt = 0;

// Core vibration function with safety checks + cooldown
const vibrate = (pattern: HapticPattern): boolean => {
  if (!canVibrate()) return false;

  const now = Date.now();
  if (now - lastHapticAt < HAPTIC_COOLDOWN_MS) return false;
  lastHapticAt = now;

  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
};

/**
 * Haptic feedback patterns for different interactions
 */
export const haptics = {
  /**
   * Light tap - for button presses, selections
   * Duration: 6ms (April 2026 — softened from 10ms)
   */
  light: (): boolean => vibrate(6),

  /**
   * Medium tap - for play/pause, navigation
   * Duration: 12ms (April 2026 — softened from 20ms)
   */
  medium: (): boolean => vibrate(12),

  /**
   * Heavy tap - for significant actions like boost, add to queue
   * Duration: 20ms (April 2026 — softened from 30ms)
   */
  heavy: (): boolean => vibrate(20),

  /**
   * Success pattern - double pulse for successful actions
   * Pattern: vibrate 10ms, pause 5ms, vibrate 10ms
   */
  success: (): boolean => vibrate([10, 5, 10]),

  /**
   * Error pattern - longer buzz for errors/failures
   * Duration: 100ms
   */
  error: (): boolean => vibrate(100),

  /**
   * Selection changed - very light feedback
   * Duration: 5ms
   */
  selection: (): boolean => vibrate(5),

  /**
   * Impact pattern - for reaction explosions (OYE 10x)
   * Pattern: 30ms vibrate, 10ms pause, 30ms vibrate
   */
  impact: (): boolean => vibrate([30, 10, 30]),

  /**
   * Notification - attention-grabbing pattern
   * Pattern: 20ms on, 50ms off, 20ms on, 50ms off, 20ms on
   */
  notification: (): boolean => vibrate([20, 50, 20, 50, 20]),

  /**
   * Custom pattern - for advanced use cases
   */
  custom: (pattern: HapticPattern): boolean => vibrate(pattern),

  /**
   * Check if haptics are supported on this device
   */
  isSupported: canVibrate,
};

/**
 * Haptic intensity levels for reaction charging
 * Returns appropriate haptic based on multiplier level (1-10)
 */
export const getReactionHaptic = (multiplier: number): (() => boolean) => {
  if (multiplier >= 10) return haptics.impact;
  if (multiplier >= 5) return haptics.heavy;
  if (multiplier >= 2) return haptics.medium;
  return haptics.light;
};

export default haptics;
