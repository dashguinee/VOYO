/**
 * usePools — React hook that loads the hot + discovery pools and returns
 * them as state so feed rows can use sync filter chains in useMemo.
 *
 * Refreshes when `sessionSeed` changes (pull-to-refresh bumps it) or when
 * the underlying trackPoolStore.hotPool length changes (curator added
 * more tracks).
 */

import { useEffect, useState } from 'react';
import type { Track } from '../../types';
import { hot, discovery, refreshPools } from './pools';
import { useTrackPoolStore } from '../../store/trackPoolStore';
import { getThumb } from '../../utils/thumbnail';

// Track which thumbnail URLs we've already pre-warmed this session so
// subsequent pool refreshes (pull-to-refresh) don't re-fetch identical
// URLs. Persistent across hook renders.
const _preloadedThumbs = new Set<string>();
function precacheThumbnails(tracks: Track[], limit: number = 20): void {
  // Fire image loads for the top N tracks so the browser cache has them
  // by the time the feed renders cards. new Image().src is the lightest
  // possible trigger — no fetch, no React state, no DOM insertion.
  for (const t of tracks.slice(0, limit)) {
    if (!t?.trackId) continue;
    const url = getThumb(t.trackId);
    if (_preloadedThumbs.has(url)) continue;
    _preloadedThumbs.add(url);
    try { const img = new Image(); img.decoding = 'async'; img.src = url; } catch { /* non-fatal */ }
  }
}

export interface PoolsState {
  hot: Track[];
  discovery: Track[];
  loading: boolean;
  refresh: () => void;
}

export function usePools(sessionSeed: number): PoolsState {
  const [hotPool, setHotPool] = useState<Track[]>([]);
  const [discoPool, setDiscoPool] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const localPoolSize = useTrackPoolStore(s => s.hotPool.length);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([hot(), discovery()])
      .then(([h, d]) => {
        if (cancelled) return;
        setHotPool(h);
        setDiscoPool(d);
        setLoading(false);
        // Prime the browser image cache for the top slice of each pool so
        // the feed paints without blank thumb tiles on first render.
        // Happens off the critical path — no await, no blocking.
        precacheThumbnails(h);
        precacheThumbnails(d);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [sessionSeed, localPoolSize]);

  return {
    hot: hotPool,
    discovery: discoPool,
    loading,
    refresh: () => {
      refreshPools();
      // sessionSeed bump in parent triggers re-fetch via effect above
    },
  };
}
