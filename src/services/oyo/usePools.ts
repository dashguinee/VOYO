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
