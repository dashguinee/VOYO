import { create } from 'zustand';
import { getYouTubeId } from '../utils/voyoId';

/**
 * warmingStore — global "this track is cooking right now" registry.
 *
 * Narralogy: orange = being added (queue / bucket landing), purple =
 * cooking (warming up to R2). Cooking is what this store represents.
 * Whenever a track is added to the bucket from a non-R2 source, mark
 * it warming → OyeButton's bubbling state lights up (purple lightning
 * pulse) until R2 confirms via r2KnownStore. Two stores, one rhythm.
 *
 * Auto-cleanup: each markWarming schedules a 60s safety timer. When
 * r2KnownStore later confirms the track, consumers prefer known over
 * warming visually (no need to actively prune from this store — the
 * 60s timer is just a backstop for tracks where R2 never lands).
 *
 * Keyed by decoded YouTube id so vyo_<base64> and raw-YT callers hit
 * the same entry.
 */
interface WarmingStore {
  warming: Set<string>;
  markWarming: (trackId: string) => void;
  clearWarming: (trackId: string) => void;
  isWarming: (trackId: string) => boolean;
}

const _timers = new Map<string, ReturnType<typeof setTimeout>>();
const SAFETY_MS = 60_000;

export const useWarmingStore = create<WarmingStore>((set, get) => ({
  warming: new Set<string>(),
  markWarming: (trackId) => {
    const id = getYouTubeId(trackId);
    if (!id) return;
    const cur = get().warming;
    if (!cur.has(id)) {
      const next = new Set(cur);
      next.add(id);
      set({ warming: next });
    }
    const existing = _timers.get(id);
    if (existing) clearTimeout(existing);
    _timers.set(id, setTimeout(() => {
      get().clearWarming(id);
    }, SAFETY_MS));
  },
  clearWarming: (trackId) => {
    const id = getYouTubeId(trackId);
    if (!id) return;
    const t = _timers.get(id);
    if (t) { clearTimeout(t); _timers.delete(id); }
    const cur = get().warming;
    if (!cur.has(id)) return;
    const next = new Set(cur);
    next.delete(id);
    set({ warming: next });
  },
  isWarming: (trackId) => get().warming.has(getYouTubeId(trackId)),
}));

export function markWarming(trackId: string): void {
  useWarmingStore.getState().markWarming(trackId);
}

export function clearWarming(trackId: string): void {
  useWarmingStore.getState().clearWarming(trackId);
}
