/**
 * LowBatteryEffect — placeholder. Subscribes to batteryState, triggers a
 * subtle visual treatment when low/critical. Currently a no-op render —
 * wire the actual effect later (candle flicker, warm dim overlay, pulse).
 *
 * Shape kept clean so swapping in the final animation is a one-file change.
 */

import { useBatteryState } from '../../services/battery';

export const LowBatteryEffect = () => {
  const battery = useBatteryState();

  // Later: render based on these flags.
  // if (battery.criticalBattery) return <CriticalPulse />;
  // if (battery.lowBattery)      return <LowDim />;
  // For now, nothing. The trace telemetry still captures battery state.
  void battery;

  return null;
};

export default LowBatteryEffect;
