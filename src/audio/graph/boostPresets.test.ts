/**
 * BOOST_PRESETS sanity tests — the preset data powers the entire EQ chain,
 * so we verify:
 *   - Required fields are present
 *   - Gain values are reasonable (no -Infinity, no 100x multipliers)
 *   - VOYEX has multiband sub-config, others don't
 */

import { describe, it, expect } from 'vitest';
import { BOOST_PRESETS } from './boostPresets';

describe('BOOST_PRESETS', () => {
  it('has three presets: boosted, calm, voyex', () => {
    expect(Object.keys(BOOST_PRESETS).sort()).toEqual(['boosted', 'calm', 'voyex']);
  });

  it('every preset has a compressor config', () => {
    for (const [name, preset] of Object.entries(BOOST_PRESETS)) {
      expect(preset.compressor, `${name} compressor`).toBeDefined();
      expect(preset.compressor.threshold, `${name} threshold`).toBeLessThanOrEqual(0);
      expect(preset.compressor.ratio, `${name} ratio`).toBeGreaterThanOrEqual(1);
      expect(preset.compressor.attack, `${name} attack`).toBeGreaterThanOrEqual(0);
      expect(preset.compressor.release, `${name} release`).toBeGreaterThan(0);
    }
  });

  it('every preset has a master gain in a reasonable range', () => {
    for (const [name, preset] of Object.entries(BOOST_PRESETS)) {
      expect(preset.gain, `${name} gain`).toBeGreaterThanOrEqual(1.0);
      expect(preset.gain, `${name} gain`).toBeLessThanOrEqual(1.5);
    }
  });

  it('VOYEX has multiband sub-config; boosted + calm do not', () => {
    expect((BOOST_PRESETS.voyex as any).multiband).toBe(true);
    expect((BOOST_PRESETS.voyex as any).low).toBeDefined();
    expect((BOOST_PRESETS.voyex as any).mid).toBeDefined();
    expect((BOOST_PRESETS.voyex as any).high).toBeDefined();
    expect((BOOST_PRESETS.boosted as any).multiband).toBeUndefined();
    expect((BOOST_PRESETS.calm as any).multiband).toBeUndefined();
  });

  it('VOYEX multiband crossovers are in ascending order', () => {
    const voyex = BOOST_PRESETS.voyex as any;
    expect(voyex.lowCrossover).toBeLessThan(voyex.highCrossover);
  });

  it('boosted is more aggressive than calm on bass gain', () => {
    expect(BOOST_PRESETS.boosted.bassGain).toBeGreaterThan(BOOST_PRESETS.calm.bassGain);
  });
});
