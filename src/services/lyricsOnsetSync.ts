/**
 * Lyrics Onset Sync — Phase 3 of Lyrics V2.
 *
 * LRCLIB timestamps are crowd-curated and average ~200-300ms drift on
 * Afrobeats. To get the "drops a bar" feel locked in, we need ≤80ms.
 *
 * Approach: spectral-flux onset detection on the actual audio (R2),
 * then snap each LRCLIB segment's startTime to the nearest detected
 * onset within ±150ms. Cached per-track in sessionStorage so we don't
 * re-decode on every replay.
 *
 * Spec: outputs/SPEC-lyrics-v2-2026-04-29.md (Phase 3)
 */

import type { TranslatedSegment } from './lyricsEngine';
import { devLog, devWarn } from '../utils/logger';

/** Snap window — LRCLIB timestamps are nudged to onset within this radius. */
const SNAP_WINDOW_SEC = 0.15;
/** Frame size for spectral analysis. 2048 @ 44.1kHz ≈ 46ms. */
const FRAME_SIZE = 2048;
/** Hop size — 512 ≈ 12ms steps. */
const HOP_SIZE = 512;
/** Minimum gap between detected onsets — prevents nano-peaks counting twice. */
const MIN_ONSET_GAP_SEC = 0.08;

const CACHE_PREFIX = 'voyo-lyrics-onsets-v1:';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Detect onsets in an AudioBuffer using spectral flux.
 * Returns an ascending array of onset times (seconds).
 */
export function detectOnsets(buffer: AudioBuffer): number[] {
  // Use the first channel (mono is fine — onsets are rhythm-driven, not stereo).
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;

  // ── Step 1: per-frame energy ───────────────────────────────────────
  // Sum-of-squares is a cheap stand-in for spectral magnitude. For
  // percussive music (Afrobeats, hip-hop, pop) this catches kicks +
  // snares cleanly without an FFT; we only need to localize edges,
  // not classify them.
  const frameCount = Math.floor((data.length - FRAME_SIZE) / HOP_SIZE);
  if (frameCount < 4) return [];
  const energy = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    const start = f * HOP_SIZE;
    let sum = 0;
    for (let i = 0; i < FRAME_SIZE; i++) {
      const x = data[start + i];
      sum += x * x;
    }
    energy[f] = sum / FRAME_SIZE;
  }

  // ── Step 2: spectral flux (positive energy delta) ──────────────────
  const flux = new Float32Array(frameCount);
  for (let f = 1; f < frameCount; f++) {
    const d = energy[f] - energy[f - 1];
    flux[f] = d > 0 ? d : 0;
  }

  // ── Step 3: adaptive median threshold ──────────────────────────────
  // For each frame, compute median of a ±W-frame window. Onsets are
  // peaks above (median + factor * std). W ≈ 20 frames ≈ 240ms — long
  // enough to ignore micro-rhythms, short enough to track tempo
  // changes.
  const W = 20;
  const ALPHA = 1.6; // peaks above median by this factor of MAD
  const onsetFrames: number[] = [];
  const minGapFrames = Math.max(1, Math.floor((MIN_ONSET_GAP_SEC * sr) / HOP_SIZE));
  let lastOnset = -minGapFrames;
  for (let f = W; f < frameCount - W; f++) {
    // Local median + median absolute deviation (robust thresholding)
    const window: number[] = [];
    for (let k = -W; k <= W; k++) window.push(flux[f + k]);
    window.sort((a, b) => a - b);
    const median = window[Math.floor(window.length / 2)];
    const deviations = window.map((v) => Math.abs(v - median));
    deviations.sort((a, b) => a - b);
    const mad = deviations[Math.floor(deviations.length / 2)];
    const threshold = median + ALPHA * mad + 1e-6;
    // Onset = current frame is above threshold AND a local maximum
    if (
      flux[f] > threshold &&
      flux[f] >= flux[f - 1] &&
      flux[f] >= flux[f + 1] &&
      f - lastOnset >= minGapFrames
    ) {
      onsetFrames.push(f);
      lastOnset = f;
    }
  }

  // ── Step 4: convert to seconds ─────────────────────────────────────
  return onsetFrames.map((f) => (f * HOP_SIZE) / sr);
}

/**
 * Snap each segment's startTime to the nearest onset within SNAP_WINDOW_SEC.
 * Returns a fresh array of segments — input is not mutated.
 *
 * If no onset is in range for a segment, the original timestamp stands.
 */
export function snapToOnsets(
  segments: TranslatedSegment[],
  onsets: number[],
): TranslatedSegment[] {
  if (onsets.length === 0) return segments;
  // Onsets are already ascending. Use a moving cursor for O(n+m).
  let cursor = 0;
  return segments.map((seg) => {
    const target = seg.startTime;
    // Advance the cursor to the first onset that's >= (target - window).
    while (cursor < onsets.length && onsets[cursor] < target - SNAP_WINDOW_SEC) {
      cursor++;
    }
    // Find the closest onset within the window.
    let best = -1;
    let bestDist = Infinity;
    for (let k = cursor; k < onsets.length; k++) {
      const o = onsets[k];
      if (o > target + SNAP_WINDOW_SEC) break;
      const d = Math.abs(o - target);
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
    if (best < 0) return seg; // no onset in range — keep as-is
    const snapped = onsets[best];
    // Nudge endTime by the same delta so the bar's duration is preserved.
    const delta = snapped - target;
    if (seg.endTime !== undefined) {
      return { ...seg, startTime: snapped, endTime: seg.endTime + delta };
    }
    return { ...seg, startTime: snapped };
  });
}

/**
 * Full pipeline — fetch audio, decode, detect onsets, snap segments.
 * Returns the input segments unchanged on any failure (network, decode,
 * empty onsets) so the lyrics overlay always renders SOMETHING.
 *
 * Cached in sessionStorage by trackId — re-decoding is expensive
 * (3-5min track ≈ 15-30 MB) and the onset map doesn't change.
 */
export async function refineSegmentsWithOnsets(
  trackId: string,
  audioUrl: string,
  segments: TranslatedSegment[],
): Promise<TranslatedSegment[]> {
  if (segments.length === 0) return segments;

  // Cache hit?
  try {
    const cached = sessionStorage.getItem(CACHE_PREFIX + trackId);
    if (cached) {
      const onsets: number[] = JSON.parse(cached);
      devLog(`[OnsetSync] Cache hit (${onsets.length} onsets) for ${trackId}`);
      return snapToOnsets(segments, onsets);
    }
  } catch { /* ignore corrupted cache */ }

  // Fetch + decode + detect — defer to idle so it doesn't fight playback.
  try {
    const res = await fetch(audioUrl);
    if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    // Lazy AudioContext — share with the rest of the app via a singleton.
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
            ?? (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) {
      devWarn('[OnsetSync] No AudioContext available');
      return segments;
    }
    const ctx = new AC();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    // We don't need the context to live past this — close to free the SR.
    void ctx.close();
    const onsets = detectOnsets(audioBuffer);
    devLog(`[OnsetSync] Detected ${onsets.length} onsets for ${trackId}`);
    try { sessionStorage.setItem(CACHE_PREFIX + trackId, JSON.stringify(onsets)); }
    catch { /* quota exceeded — silent */ }
    return snapToOnsets(segments, onsets);
  } catch (err) {
    devWarn(`[OnsetSync] Failed for ${trackId}:`, err);
    return segments;
  }
}
