/**
 * Frequency Pump — reads the AnalyserNode at ~10fps and writes CSS custom
 * properties to `document.documentElement`. All visual components read
 * these via `var(--voyo-bass)` / `--voyo-mid` / `--voyo-treble` / `--voyo-energy`
 * in their CSS. Zero React re-renders, pure GPU-composited visual response.
 *
 * Architecture:
 *   - 10fps (every 6th rAF). 60fps is overkill for visual music feedback
 *     and competes with the audio thread on weak devices.
 *   - Pre-allocated Uint8Array — no GC per frame.
 *   - Visibility-gated: stops when document is hidden (rAF paused anyway).
 *   - Only runs while isPlaying (no work when paused).
 *   - Delta-gated CSS writes (>5% change) — skips 2-3 style recalcs per
 *     frame when nothing visibly changed.
 *
 * Values:
 *   --voyo-bass    : 0-1 avg of bins 0-15 (~60-250Hz)
 *   --voyo-mid     : 0-1 avg of bins 16-80 (~250-5kHz)
 *   --voyo-treble  : 0-1 avg of bins 81-127 (~5-20kHz)
 *   --voyo-energy  : 0-1 RMS over all bins
 */

import { useEffect, useRef } from 'react';
import { getAnalyser } from '../../services/audioEngine';

export function useFrequencyPump(isPlaying: boolean) {
  const bufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      const root = document.documentElement;
      root.style.setProperty('--voyo-bass', '0');
      root.style.setProperty('--voyo-mid', '0');
      root.style.setProperty('--voyo-treble', '0');
      root.style.setProperty('--voyo-energy', '0');
      return;
    }

    let frameCount = 0;
    let rafId = 0;
    let wasHidden = false;

    const pump = () => {
      rafId = requestAnimationFrame(pump);
      if (document.hidden) { wasHidden = true; return; }
      if (wasHidden) { frameCount = 0; wasHidden = false; }
      if (++frameCount % 6 !== 0) return;

      const analyser = getAnalyser();
      if (!analyser) return;
      if (!bufRef.current) {
        bufRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      }
      const buf = bufRef.current;
      analyser.getByteFrequencyData(buf);

      let bass = 0, mid = 0, treble = 0, total = 0;
      const len = buf.length;
      for (let i = 0; i < len; i++) {
        const v = buf[i];
        total += v;
        if (i < 16) bass += v;
        else if (i < 80) mid += v;
        else treble += v;
      }
      bass = (bass / 16) / 255;
      mid = (mid / 64) / 255;
      treble = (treble / 48) / 255;
      const energy = (total / len) / 255;

      const root = document.documentElement;
      const DELTA = 0.05;
      const prev = {
        bass: parseFloat(root.style.getPropertyValue('--voyo-bass') || '0'),
        mid: parseFloat(root.style.getPropertyValue('--voyo-mid') || '0'),
        treble: parseFloat(root.style.getPropertyValue('--voyo-treble') || '0'),
        energy: parseFloat(root.style.getPropertyValue('--voyo-energy') || '0'),
      };
      if (Math.abs(bass - prev.bass) > DELTA) root.style.setProperty('--voyo-bass', bass.toFixed(3));
      if (Math.abs(mid - prev.mid) > DELTA) root.style.setProperty('--voyo-mid', mid.toFixed(3));
      if (Math.abs(treble - prev.treble) > DELTA) root.style.setProperty('--voyo-treble', treble.toFixed(3));
      if (Math.abs(energy - prev.energy) > DELTA) root.style.setProperty('--voyo-energy', energy.toFixed(3));
    };

    rafId = requestAnimationFrame(pump);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying]);
}
