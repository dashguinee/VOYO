/**
 * Battery monitor — correlates BG audio issues with power state.
 *
 * navigator.getBattery() is officially deprecated but still functional on
 * Chrome Android (our primary BG-playback target). Firefox and Safari don't
 * have it; we silently no-op there.
 *
 * Why track this:
 *   - Android Chrome throttles BG tabs much harder under Power Save mode
 *     (typically <15-20% battery OR user-toggled). MessageChannel heartbeats,
 *     audio focus, even audio context itself can be aggressively suspended.
 *   - If BG playback fails and battery was low + not charging, that's the
 *     real root cause — no keepalive trick overrides the OS at that point.
 *   - Having the telemetry correlation lets us distinguish 'our code broken'
 *     from 'phone decided to save battery and there was nothing we could do.'
 *
 * Later: a LowBatteryEffect UI component will subscribe to this store to
 * render a subtle low-battery visual state (candle-flicker or similar).
 */

import { useEffect, useState } from 'react';
import { trace } from './telemetry';

export interface BatteryState {
  supported: boolean;
  level: number;          // 0.0 to 1.0 (e.g. 0.34 = 34%)
  charging: boolean;
  chargingTime: number;   // seconds until full (Infinity if not charging)
  dischargingTime: number; // seconds until empty (Infinity if charging or unknown)
  lowBattery: boolean;    // convenience: level < 0.20 && !charging
  criticalBattery: boolean; // level < 0.10 && !charging
}

const INITIAL: BatteryState = {
  supported: false,
  level: 1,
  charging: true,
  chargingTime: Infinity,
  dischargingTime: Infinity,
  lowBattery: false,
  criticalBattery: false,
};

// Module-level store — lightweight pub/sub so the hook + telemetry can share.
let state: BatteryState = INITIAL;
const listeners = new Set<(s: BatteryState) => void>();
function publish(next: BatteryState) {
  state = next;
  listeners.forEach(fn => fn(next));
}

function derive(batt: { level: number; charging: boolean; chargingTime: number; dischargingTime: number }): BatteryState {
  return {
    supported: true,
    level: batt.level,
    charging: batt.charging,
    chargingTime: batt.chargingTime,
    dischargingTime: batt.dischargingTime,
    lowBattery: batt.level < 0.20 && !batt.charging,
    criticalBattery: batt.level < 0.10 && !batt.charging,
  };
}

export function getBatteryState(): BatteryState {
  return state;
}

/**
 * Initialize once on app boot. Reads current state, subscribes to change
 * events, logs each change to trace telemetry so we can correlate with
 * audio events later.
 */
export async function initBatteryMonitor(): Promise<void> {
  if (typeof navigator === 'undefined' || !('getBattery' in navigator)) {
    // Not supported — stay on the INITIAL default (supported: false).
    trace('battery_init', null, { supported: false });
    return;
  }
  try {
    const batt = await (navigator as any).getBattery();
    const initial = derive(batt);
    publish(initial);
    trace('battery_init', null, {
      level: Math.round(batt.level * 100),
      charging: batt.charging,
      lowBattery: initial.lowBattery,
    });

    const onChange = () => {
      const next = derive(batt);
      const prev = state;
      publish(next);
      // Only log when something meaningful changes (not every decimal)
      const levelDelta = Math.round(prev.level * 100) !== Math.round(next.level * 100);
      const chargingChanged = prev.charging !== next.charging;
      const threshCrossed = prev.lowBattery !== next.lowBattery || prev.criticalBattery !== next.criticalBattery;
      if (levelDelta || chargingChanged || threshCrossed) {
        trace('battery_change', null, {
          level: Math.round(batt.level * 100),
          charging: batt.charging,
          lowBattery: next.lowBattery,
          criticalBattery: next.criticalBattery,
          dischargingTimeSec: Number.isFinite(batt.dischargingTime) ? batt.dischargingTime : -1,
        });
      }
    };
    // Subscribe ONLY to the events that produce meaningful state changes.
    // dischargingtimechange + chargingtimechange fire every few seconds on
    // Android Chrome — noisy re-renders for everyone on useBatteryState +
    // trace event spam that wasn't telling us anything. levelchange +
    // chargingchange are the two that matter.
    batt.addEventListener('levelchange', onChange);
    batt.addEventListener('chargingchange', onChange);
  } catch (e) {
    trace('battery_init', null, { supported: false, err: (e as Error)?.message?.slice(0, 60) });
  }
}

/**
 * React hook for components that want to re-render on battery change
 * (e.g. the future LowBatteryEffect).
 */
export function useBatteryState(): BatteryState {
  const [s, setS] = useState<BatteryState>(state);
  useEffect(() => {
    const fn = (next: BatteryState) => setS(next);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return s;
}
