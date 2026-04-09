/**
 * VOYO Music - Haptic Feedback System
 * TikTok/Instagram-level haptic feedback for mobile interactions
 */

type HapticPattern = number | number[];

// Check if vibration API is supported
const canVibrate = (): boolean => {
  return typeof navigator !== 'undefined' && 'vibrate' in navigator;
};

// Core vibration function with safety checks
const vibrate = (pattern: HapticPattern): boolean => {
  if (!canVibrate()) return false;

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
   * Duration: 10ms
   */
  light: (): boolean => vibrate(10),

  /**
   * Medium tap - for play/pause, navigation
   * Duration: 20ms
   */
  medium: (): boolean => vibrate(20),

  /**
   * Heavy tap - for significant actions like boost, add to queue
   * Duration: 30ms
   */
  heavy: (): boolean => vibrate(30),

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
