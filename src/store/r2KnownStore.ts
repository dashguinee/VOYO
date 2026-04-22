import { create } from 'zustand';
import { getYouTubeId } from '../utils/voyoId';

/**
 * r2KnownStore — a live, in-session cache of "tracks we've confirmed are
 * in R2." Used by OyeButton / BoostButton to flip to the gold-filled +
 * gold-faded states AS SOON AS the track is known to be instantly
 * playable from the edge, not just after a LOCAL IndexedDB download
 * completes.
 *
 * Three populate paths:
 *   1. r2Probe.r2HasTrack resolves true → add (authoritative HEAD check).
 *   2. useHotSwap successfully crossfades iframe → R2 → add (proof of
 *      existence; the hotswap wouldn't have succeeded otherwise).
 *   3. gateToR2 / search results discover cached tracks via
 *      video_intelligence.r2_cached → add (bulk hydrate on surface open).
 *
 * Keyed by the DECODED YouTube id so vyo_<base64> callers and raw-YT
 * callers hit the same entry.
 *
 * Session-scoped — not persisted. On a fresh load we re-learn what's in
 * R2 from the same three paths above. No staleness hazard: if the entry
 * is ever wrong (track removed from R2 server-side), the next playback
 * attempt will reveal it and the hotswap will fall back to iframe.
 */
interface R2KnownStore {
  known: Set<string>;
  add: (trackId: string) => void;
  addMany: (trackIds: string[]) => void;
  has: (trackId: string) => boolean;
}

export const useR2KnownStore = create<R2KnownStore>((set, get) => ({
  known: new Set<string>(),
  add: (trackId) => {
    const id = getYouTubeId(trackId);
    if (!id) return;
    const cur = get().known;
    if (cur.has(id)) return;
    const next = new Set(cur);
    next.add(id);
    set({ known: next });
  },
  addMany: (trackIds) => {
    const cur = get().known;
    let mutated = false;
    const next = new Set(cur);
    for (const raw of trackIds) {
      const id = getYouTubeId(raw);
      if (id && !next.has(id)) {
        next.add(id);
        mutated = true;
      }
    }
    if (mutated) set({ known: next });
  },
  has: (trackId) => get().known.has(getYouTubeId(trackId)),
}));

/** Imperative helper for non-React callers (r2Probe, gateToR2, etc). */
export function markR2Known(trackId: string): void {
  useR2KnownStore.getState().add(trackId);
}

export function markR2KnownMany(trackIds: string[]): void {
  useR2KnownStore.getState().addMany(trackIds);
}
